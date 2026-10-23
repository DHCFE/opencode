import { Schema } from "effect"
import { createEffect, createMemo, onCleanup, untrack } from "solid-js"
import { createStore } from "solid-js/store"
import { Session } from "@opencode/schema/session"
import { SessionMessage } from "@opencode/schema/session-message"
import { useLanguage } from "@/runtime/i18n/language"
import { persisted, Persist } from "@/runtime/persistence/storage"
import { Persistence } from "@/runtime/persistence/schema"
import { useData, useServer } from "@/runtime/server/current"
import { useServerSDK } from "@/runtime/server/client"
import { createParallelQueue } from "./queue"

const Branch = Persistence.struct({
  id: Schema.String,
  sessionID: Schema.String,
  providerID: Schema.String,
  modelID: Schema.String,
  name: Schema.String,
  status: Schema.Literals(["queued", "running", "completed", "failed", "cancelled", "interrupted"]),
  admitted: Schema.Boolean,
  created: Schema.optional(Schema.Boolean),
  directory: Schema.optional(Schema.String),
  error: Schema.optional(Schema.String),
})

const Task = Persistence.struct({
  id: Schema.String,
  prompt: Schema.String,
  directory: Schema.String,
  agentID: Schema.optional(Schema.String),
  created: Schema.Number,
  branches: Persistence.array(Branch),
})

const State = Persistence.struct({
  tasks: Persistence.array(Task),
  activeId: Schema.optional(Schema.String),
})

export type ParallelBranch = typeof Branch.Type

export type ParallelTask = typeof Task.Type

export type ParallelSelection = { providerID: string; modelID: string; instances: number }

export type ParallelMessage = { id: string; role: "user" | "assistant"; text: string }

export function createParallel() {
  const data = useData()
  const server = useServer()
  const sdk = useServerSDK()
  const language = useLanguage()
  const [state, set, , ready] = persisted(Persist.serverGlobal(sdk.scope, "parallel.v1"), State, { tasks: [] })
  const queue = createParallelQueue()
  const cancelled = new Set<string>()
  const lifecycle = { disposed: false, restored: false }
  const [selection, setSelection] = createStore({ directory: "" })
  const directory = () => selection.directory || server.ctx.projects.last() || data.location.default().directory

  const agents = createMemo(() =>
    (data.location.agent.list({ directory: directory() }) ?? []).filter(
      (agent) => !agent.hidden && agent.mode !== "subagent",
    ),
  )

  const models = createMemo(() => {
    const providers = data.location.provider.list({ directory: directory() }) ?? []

    return (data.location.model.list({ directory: directory() }) ?? [])
      .filter((model) => model.enabled && model.status !== "deprecated" && model.capabilities.input.includes("text"))
      .map((model) => ({
        providerID: model.providerID,
        modelID: model.id,
        name: model.name,
        providerName: providers.find((provider) => provider.id === model.providerID)?.name ?? model.providerID,
      }))
  })

  createEffect(() => {
    if (sdk.connection.status() !== "connected") return
    const selected = directory()
    void data.location
      .syncInfo(selected ? { directory: selected } : undefined)
      .then(() => {
        const location = { directory: directory() }
        return Promise.all([
          data.location.provider.sync(location),
          data.location.model.sync(location),
          data.location.agent.sync(location),
        ])
      })
      .catch(() => undefined)
  })

  function find(id: string) {
    const task = state.tasks.find((task) => task.branches.some((branch) => branch.id === id))
    const branch = task?.branches.find((branch) => branch.id === id)

    return task && branch ? { task, branch } : undefined
  }

  function update(id: string, value: Partial<ParallelBranch>) {
    set(
      "tasks",
      (task) => task.branches.some((branch) => branch.id === id),
      "branches",
      (branch) => branch.id === id,
      value,
    )
  }

  const messages = (id: string) => {
    const item = find(id)

    if (!item) return []

    return data.session.message.list(item.branch.sessionID).flatMap<ParallelMessage>((message) => {
      if (message.type === "user") return [{ id: message.id, role: "user" as const, text: message.text }]

      if (message.type !== "assistant") return []

      return [
        {
          id: message.id,
          role: "assistant" as const,
          text: message.content.flatMap((part) => (part.type === "text" ? [part.text] : [])).join("\n"),
        },
      ]
    })
  }

  function failed(id: string, detail: string, limited = /\b429\b|usage_limit_exceeded/i.test(detail)) {
    update(id, { status: "failed", error: detail })
    const item = find(id)

    if (!item || !limited) return

    // Stop only work that has not begun. Other providers and already-streaming sessions remain independent.
    state.tasks
      .flatMap((task) => task.branches)
      .filter((branch) => branch.providerID === item.branch.providerID && branch.status === "queued")
      .forEach((branch) => {
        cancelled.add(branch.id)
        queue.cancel(branch.id)
        update(branch.id, { status: "cancelled", error: language.t("parallel.error.quota") })
      })
  }

  async function finish(id: string) {
    const item = find(id)

    if (!item) return
    await sdk.api.session.wait({ sessionID: item.branch.sessionID })
    // Explicit completion also reconciles missed stream events and cached follow-up history.
    data.session.invalidate(item.branch.sessionID)
    data.session.message.invalidate(item.branch.sessionID)
    await Promise.all([data.session.sync(item.branch.sessionID), data.session.message.sync(item.branch.sessionID)])

    if (cancelled.has(id) || lifecycle.disposed) return
    const info = data.session.get(item.branch.sessionID)
    const error = data.session.message
      .list(item.branch.sessionID)
      .findLast((message) => message.type === "assistant")?.error

    if (error) {
      const code = error.response?.body.match(/\b\w*usage_limit_exceeded\b/i)?.[0]
      failed(
        id,
        [error.type, error.status, code, error.message].filter(Boolean).join(": "),
        error.status === 429 || /usage_limit_exceeded/i.test(`${error.type} ${error.message} ${code ?? ""}`),
      )
      return
    }

    const status = info?.outcome === "failed" ? "failed" : info?.outcome === "interrupted" ? "interrupted" : "completed"
    update(id, { status, error: status === "failed" ? language.t("parallel.error.failed") : undefined })
  }

  function enqueue(id: string, text: string) {
    cancelled.delete(id)
    update(id, { status: "queued", error: undefined })

    return queue
      .add(id, async () => {
        const item = find(id)

        if (!item || cancelled.has(id) || lifecycle.disposed) return

        if (sdk.connection.status() !== "connected") throw new Error(language.t("parallel.error.connection"))
        update(id, { status: "running" })

        if (!item.branch.directory) {
          const location = await sdk.api.location.get({ location: { directory: item.task.directory } })
          if ((await sdk.api.project.list()).find((project) => project.id === location.project.id)?.vcs !== "git")
            throw new Error(language.t("parallel.error.git"))
          const worktree = await sdk.api.worktree.create({
            projectID: location.project.id,
            from: item.task.directory,
            name: `parallel-${item.branch.id.slice(-12)}`,
          })
          update(id, { directory: worktree.directory })
          await data.location.syncInfo({ directory: worktree.directory })
        }

        if (cancelled.has(id) || lifecycle.disposed) return

        if (!item.branch.created) {
          // Isolate edits through the upstream workspace API; retain normal agent permission prompts.
          const info = await sdk.api.session.create({
            id: item.branch.sessionID,
            title: item.task.prompt.slice(0, 80),
            model: { id: item.branch.modelID, providerID: item.branch.providerID },
            location: { directory: item.branch.directory! },
            agent: item.task.agentID,
          })

          data.session.remember(info)
          update(id, { created: true })
        }

        if (cancelled.has(id) || lifecycle.disposed) return
        await data.session.prompt({ id: SessionMessage.ID.create(), sessionID: item.branch.sessionID, text })
        update(id, { admitted: true })

        if (cancelled.has(id)) {
          await sdk.api.session.interrupt({ sessionID: item.branch.sessionID })

          return
        }

        await finish(id)
      })
      .catch((error: unknown) => {
        if (!cancelled.has(id) && !lifecycle.disposed)
          failed(id, error instanceof Error ? error.message : language.t("parallel.error.failed"))
      })
  }

  createEffect(() => {
    if (!ready() || sdk.connection.status() !== "connected" || lifecycle.restored) return
    lifecycle.restored = true
    void untrack(async () => {
      const active = await sdk.api.session.active()
      await Promise.all(
        state.tasks.flatMap((task) =>
          task.branches.map(async (branch) => {
            if (queue.busy(branch.id)) return

            if (!branch.admitted) {
              if (branch.status === "queued" || branch.status === "running")
                update(branch.id, { status: "interrupted" })

              return
            }

            await Promise.all([
              data.session.sync(branch.sessionID),
              data.session.message.sync(branch.sessionID),
              data.session.permission.sync(branch.sessionID),
              data.session.form.sync(branch.sessionID),
            ])

            if (!active[branch.sessionID]) {
              if (branch.status === "running" || branch.status === "queued") {
                const outcome = data.session.get(branch.sessionID)?.outcome
                update(branch.id, {
                  status: outcome === "succeeded" ? "completed" : outcome === "failed" ? "failed" : "interrupted",
                })
              }

              return
            }

            update(branch.id, { status: "running" })
            void queue.add(branch.id, () => finish(branch.id)).catch(() => update(branch.id, { status: "interrupted" }))
          }),
        ),
      )
    }).catch(() => {
      state.tasks
        .flatMap((task) => task.branches)
        .filter((branch) => branch.status === "running")
        .forEach((branch) => update(branch.id, { status: "interrupted", error: language.t("parallel.error.recovery") }))
    })
  })

  // Full-session prompts use the upstream composer; keep their state visible in the overview too.
  createEffect(() => {
    if (!ready()) return
    state.tasks
      .flatMap((task) => task.branches)
      .forEach((branch) => {
        if (!branch.admitted) return
        const running = data.session.status(branch.sessionID) === "running"
        if (!running || queue.busy(branch.id)) return
        update(branch.id, { status: "running", error: undefined })
        void queue
          .add(branch.id, () => finish(branch.id))
          .catch((error: unknown) => {
            if (!lifecycle.disposed)
              failed(branch.id, error instanceof Error ? error.message : language.t("parallel.error.failed"))
          })
      })
  })

  onCleanup(() => {
    lifecycle.disposed = true
    queue.clear()
  })

  return {
    state,
    ready,
    models,
    agents,
    projects: () => server.ctx.projects.list(),
    directory,
    setDirectory(directory: string) {
      setSelection("directory", directory)
    },
    active: () => state.tasks.find((task) => task.id === state.activeId),
    select(id: string) {
      set("activeId", id)
    },
    async start(prompt: string, selections: ParallelSelection[], target?: string, agentID?: string) {
      await ready.promise
      if (!target && !directory()) await data.location.syncInfo()
      const selectedDirectory = target || directory()

      if (!prompt.trim() || !selections.length || !selectedDirectory)
        throw new Error(language.t("parallel.error.empty"))
      const count = selections.reduce((sum, selection) => sum + selection.instances, 0)

      if (
        !Number.isInteger(count) ||
        count < 1 ||
        count > 8 ||
        selections.some((selection) => !Number.isInteger(selection.instances) || selection.instances < 1)
      )
        throw new Error(language.t("parallel.error.limit"))
      const location = await sdk.api.location.get({ location: { directory: selectedDirectory } })
      if ((await sdk.api.project.list()).find((project) => project.id === location.project.id)?.vcs !== "git")
        throw new Error(language.t("parallel.error.git"))
      const available = await sdk.api.model.list({ location: { directory: selectedDirectory } })

      if (
        selections.some(
          (selection) =>
            !available.data.some(
              (model) => model.enabled && model.id === selection.modelID && model.providerID === selection.providerID,
            ),
        )
      )
        throw new Error(language.t("parallel.error.models"))
      const id = crypto.randomUUID()

      const branches = selections.flatMap((selection) =>
        Array.from({ length: selection.instances }, () => {
          const sessionID = Session.ID.create()

          return {
            id: sessionID,
            sessionID,
            providerID: selection.providerID,
            modelID: selection.modelID,
            name: available.data.find(
              (model) => model.id === selection.modelID && model.providerID === selection.providerID,
            )!.name,
            status: "queued" as const,
            admitted: false,
          }
        }),
      )

      set("tasks", state.tasks.length, {
        id,
        prompt: prompt.trim(),
        directory: selectedDirectory,
        agentID,
        created: Date.now(),
        branches,
      })
      set("activeId", id)
      branches.forEach((branch) => void enqueue(branch.id, prompt.trim()))

      return id
    },
    async cancel(id: string) {
      const item = find(id)

      if (!item) return
      cancelled.add(id)
      queue.cancel(id)
      update(id, { status: "cancelled", error: undefined })

      if (!item.branch.admitted) return
      await sdk.api.session.interrupt({ sessionID: item.branch.sessionID }).catch((error: unknown) => {
        update(id, {
          status: "failed",
          error: error instanceof Error ? error.message : language.t("parallel.error.failed"),
        })
      })
    },
    async send(id: string, text: string) {
      const item = find(id)

      if (!item || !text.trim()) return

      if (item.branch.admitted && !item.branch.directory) {
        update(id, { error: language.t("parallel.error.legacy") })
        return
      }

      if (item.branch.status === "running" || item.branch.status === "queued" || queue.busy(id)) return
      await enqueue(id, item.branch.admitted ? text.trim() : `${item.task.prompt}\n\n${text.trim()}`)
    },
    move(id: string, beforeID: string) {
      const item = find(id)

      if (!item || id === beforeID || !item.task.branches.some((branch) => branch.id === beforeID)) return
      const branches = item.task.branches.filter((branch) => branch.id !== id)
      branches.splice(
        branches.findIndex((branch) => branch.id === beforeID),
        0,
        item.branch,
      )
      set("tasks", (task) => task.id === item.task.id, "branches", branches)
    },
    messages,
    requests: (id: string) => {
      const item = find(id)
      if (!item) return 0
      return (
        (data.session.permission.list(item.branch.sessionID)?.length ?? 0) +
        (data.session.form.list(item.branch.sessionID)?.length ?? 0)
      )
    },
    text: (id: string) => messages(id).findLast((message) => message.role === "assistant")?.text ?? "",
  }
}

export type ParallelController = ReturnType<typeof createParallel>
