import { A } from "@solidjs/router"
import { createEffect, createMemo, For, Show } from "solid-js"
import { createStore } from "solid-js/store"
import { useServer } from "@/runtime/server/current"
import { useDialog } from "@opencode/ui/context/dialog"
import { useIntegrations } from "@/providers/catalog/integrations"
import { sessionHref } from "@/shell/routes/session"
import { useLanguage } from "@/runtime/i18n/language"
import { useParallel } from "./context"
import "./style.css"

export function ParallelRoute() {
  const language = useLanguage()
  const parallel = useParallel()
  const server = useServer()
  const dialog = useDialog()
  const integrations = useIntegrations(() => parallel.directory())
  const chatgptConnected = () =>
    integrations
      .list()
      .some(
        (item) =>
          item.id === "openai" &&
          item.connections.some((connection) => connection.type === "credential" && connection.method === "oauth"),
      )
  async function connect(provider?: string) {
    const { DialogConnectProvider, useProviderConnectController } = await import("@/providers/connect/dialog")
    const controller = useProviderConnectController()
    controller.select(provider)
    void dialog.show(() => <DialogConnectProvider controller={controller} directory={parallel.directory()} />)
  }
  const [state, set] = createStore({
    prompt: "",
    agentID: "",
    selections: [] as { key: string; instances: number }[],
    selected: "",
    reply: "",
    busy: false,
    error: "",
    dragging: "",
  })
  const modelKey = (model: { providerID: string; modelID: string }) => JSON.stringify([model.providerID, model.modelID])
  const total = () => state.selections.reduce((sum, row) => sum + row.instances, 0)
  const selected = createMemo(() => parallel.active()?.branches.find((branch) => branch.id === state.selected))
  createEffect(() => {
    if (state.selections.length || !parallel.models().length) return
    set("selections", [{ key: modelKey(parallel.models()[0]), instances: 2 }])
  })
  async function start() {
    set({ busy: true, error: "" })
    await parallel
      .start(
        state.prompt,
        state.selections.flatMap((row) => {
          const model = parallel.models().find((model) => modelKey(model) === row.key)
          return model ? [{ providerID: model.providerID, modelID: model.modelID, instances: row.instances }] : []
        }),
        parallel.directory(),
        state.agentID || undefined,
      )
      .then(() => set({ selected: "", reply: "" }))
      .catch((error: unknown) => {
        set("error", error instanceof Error ? error.message : language.t("parallel.error.failed"))
      })
      .finally(() => set("busy", false))
  }
  function move(id: string, offset: number) {
    const branches = parallel.active()?.branches ?? []
    const index = branches.findIndex((branch) => branch.id === id)
    if (offset < 0 && index > 0) parallel.move(id, branches[index - 1].id)
    if (offset > 0 && index < branches.length - 1) parallel.move(branches[index + 1].id, id)
  }
  return (
    <main class="parallel-workspace">
      <header class="parallel-masthead">
        <A href="/" class="parallel-brand">
          OpenCode<span aria-hidden="true"> / </span>
        </A>
        <span>{language.t("parallel.title")}</span>
        <A class="parallel-settings" href="/projects">
          {language.t("parallel.projects")} ↗
        </A>
        <button
          type="button"
          class="parallel-account"
          onClick={() => void connect(chatgptConnected() ? undefined : "openai")}
        >
          {language.t(chatgptConnected() ? "parallel.account" : "parallel.signin")}
        </button>
      </header>
      <div class="parallel-layout">
        <section class="parallel-compose">
          <p class="parallel-eyebrow">{language.t("parallel.eyebrow")}</p>
          <h1>{language.t("parallel.subtitle")}</h1>
          <Show when={integrations.ready() && !chatgptConnected()}>
            <div class="parallel-onboarding">
              <p>{language.t("parallel.signinHint")}</p>
              <button type="button" class="parallel-account" onClick={() => void connect("openai")}>
                {language.t("parallel.signin")} ↗
              </button>
              <button type="button" class="parallel-other-provider" onClick={() => void connect()}>
                {language.t("parallel.otherProvider")}
              </button>
            </div>
          </Show>
          <form
            onSubmit={(event) => {
              event.preventDefault()
              void start()
            }}
          >
            <label class="parallel-label" for="parallel-project">
              {language.t("parallel.project")}
            </label>
            <select
              id="parallel-project"
              class="parallel-project"
              value={parallel.directory()}
              onChange={(event) => {
                parallel.setDirectory(event.currentTarget.value)
                set({ selections: [], agentID: "" })
              }}
            >
              <Show when={!parallel.projects().length}>
                <option value="">{language.t("parallel.chooseProject")}</option>
              </Show>
              <For each={parallel.projects()}>
                {(project) => <option value={project.worktree}>{project.worktree}</option>}
              </For>
            </select>
            <label class="parallel-label" for="parallel-agent">
              {language.t("parallel.agent")}
            </label>
            <select
              id="parallel-agent"
              class="parallel-project"
              value={state.agentID}
              onChange={(event) => set("agentID", event.currentTarget.value)}
            >
              <option value="">{language.t("parallel.defaultAgent")}</option>
              <For each={parallel.agents()}>{(agent) => <option value={agent.id}>{agent.name}</option>}</For>
            </select>
            <label class="parallel-label" for="parallel-prompt">
              {language.t("parallel.prompt")}
            </label>
            <textarea
              id="parallel-prompt"
              class="parallel-prompt"
              placeholder={language.t("parallel.placeholder")}
              value={state.prompt}
              onInput={(event) => set("prompt", event.currentTarget.value)}
              required
            />
            <div class="parallel-section-label">
              <h2>{language.t("parallel.models")}</h2>
              <span>{total()} / 8</span>
            </div>
            <Show
              when={parallel.models().length}
              fallback={<p class="parallel-muted">{language.t("parallel.noModels")}</p>}
            >
              <div class="parallel-models">
                <For each={state.selections}>
                  {(row, index) => (
                    <div class="parallel-model-row">
                      <select
                        aria-label={language.t("parallel.models")}
                        value={row.key}
                        onChange={(event) => set("selections", index(), "key", event.currentTarget.value)}
                      >
                        <For each={parallel.models()}>
                          {(model) => (
                            <option value={modelKey(model)}>
                              {model.name} · {model.providerName}
                            </option>
                          )}
                        </For>
                      </select>
                      <input
                        aria-label={language.t("parallel.instances")}
                        type="number"
                        min="1"
                        max="8"
                        value={row.instances}
                        onInput={(event) =>
                          set("selections", index(), "instances", event.currentTarget.valueAsNumber || 1)
                        }
                      />
                      <button
                        type="button"
                        class="parallel-icon"
                        aria-label={language.t("parallel.remove")}
                        disabled={state.selections.length === 1}
                        onClick={() => set("selections", (rows) => rows.filter((_, i) => i !== index()))}
                      >
                        ×
                      </button>
                    </div>
                  )}
                </For>
              </div>
              <button
                type="button"
                class="parallel-add"
                disabled={total() >= 8}
                onClick={() =>
                  set("selections", (rows) => [...rows, { key: modelKey(parallel.models()[0]), instances: 1 }])
                }
              >
                + {language.t("parallel.add")}
              </button>
            </Show>
            <button
              class="parallel-primary"
              type="submit"
              disabled={
                state.busy || !parallel.ready() || !state.prompt.trim() || !state.selections.length || total() > 8
              }
            >
              {language.t(state.busy ? "parallel.starting" : "parallel.start")} <span aria-hidden="true">↗</span>
            </button>
            <p class="parallel-footnote">{language.t("parallel.note")}</p>
            <Show when={state.error}>
              <p class="parallel-error" role="alert">
                {state.error}
              </p>
            </Show>
          </form>
          <Show when={parallel.state.tasks.length}>
            <nav class="parallel-history" aria-label={language.t("parallel.history")}>
              <h2>{language.t("parallel.history")}</h2>
              <For each={[...parallel.state.tasks].reverse()}>
                {(task) => (
                  <button
                    classList={{ active: parallel.state.activeId === task.id }}
                    onClick={() => {
                      parallel.select(task.id)
                      set({ selected: "", reply: "" })
                    }}
                  >
                    {task.prompt}
                  </button>
                )}
              </For>
            </nav>
          </Show>
        </section>
        <section class="parallel-results" aria-label={language.t("parallel.results")}>
          <div class="parallel-results-heading">
            <h2>{language.t("parallel.results")}</h2>
            <span class="parallel-muted">{parallel.active()?.branches.length ?? 0}</span>
          </div>
          <Show
            when={parallel.active()}
            fallback={
              <div class="parallel-empty">
                <div class="parallel-empty-mark" aria-hidden="true">
                  <i />
                  <i />
                  <i />
                </div>
                <h2>{language.t("parallel.emptyTitle")}</h2>
                <p>{language.t("parallel.emptyBody")}</p>
              </div>
            }
          >
            {(task) => (
              <>
                <p class="parallel-task-prompt">{task().prompt}</p>
                <div class="parallel-branches">
                  <For each={task().branches}>
                    {(branch, index) => (
                      <article
                        class="parallel-branch"
                        classList={{ selected: state.selected === branch.id }}
                        onDragOver={(event) => event.preventDefault()}
                        onDrop={(event) => {
                          event.preventDefault()
                          parallel.move(state.dragging, branch.id)
                          set("dragging", "")
                        }}
                      >
                        <div class="parallel-branch-top">
                          <span
                            class="parallel-drag"
                            draggable="true"
                            title={language.t("parallel.drag")}
                            onDragStart={(event) => {
                              set("dragging", branch.id)
                              event.dataTransfer?.setData("text/plain", branch.id)
                            }}
                            aria-hidden="true"
                          >
                            ⠿
                          </span>
                          <span class="parallel-number">{String(index() + 1).padStart(2, "0")}</span>
                          <strong>{branch.name}</strong>
                          <span class="parallel-status" data-status={branch.status}>
                            {language.t(`parallel.status.${branch.status}`)}
                          </span>
                          <button
                            class="parallel-icon"
                            aria-label={language.t("parallel.up")}
                            disabled={index() === 0}
                            onClick={() => move(branch.id, -1)}
                          >
                            ↑
                          </button>
                          <button
                            class="parallel-icon"
                            aria-label={language.t("parallel.down")}
                            disabled={index() === task().branches.length - 1}
                            onClick={() => move(branch.id, 1)}
                          >
                            ↓
                          </button>
                        </div>
                        <button
                          class="parallel-branch-open"
                          aria-label={`${language.t("parallel.expand")} · ${branch.name} · ${index() + 1}`}
                          onClick={() => set({ selected: branch.id, reply: "" })}
                        >
                          <p classList={{ "parallel-error": !!branch.error }}>
                            {branch.error || parallel.text(branch.id) || language.t("parallel.waiting")}
                          </p>
                          <span>
                            {language.t("parallel.expand")} <span aria-hidden="true">↗</span>
                          </span>
                        </button>
                        <Show when={branch.created || branch.admitted}>
                          <A
                            class="parallel-full-session"
                            classList={{ "parallel-needs-review": parallel.requests(branch.id) > 0 }}
                            href={sessionHref(server.key, branch.sessionID)}
                          >
                            {language.t(parallel.requests(branch.id) > 0 ? "parallel.review" : "parallel.fullSession")}{" "}
                            ↗
                          </A>
                        </Show>
                        <Show when={branch.directory}>
                          <p class="parallel-worktree" title={branch.directory}>
                            {branch.directory}
                          </p>
                        </Show>
                        <Show when={branch.status === "running" || branch.status === "queued"}>
                          <button class="parallel-stop" onClick={() => void parallel.cancel(branch.id)}>
                            {language.t("parallel.stop")}
                          </button>
                        </Show>
                      </article>
                    )}
                  </For>
                </div>
              </>
            )}
          </Show>
        </section>
      </div>
      <Show when={selected()}>
        {(branch) => (
          <aside class="parallel-conversation" aria-label={`${language.t("parallel.branch")} · ${branch().name}`}>
            <header>
              <div>
                <p class="parallel-eyebrow">{language.t("parallel.branch")}</p>
                <h2>{branch().name}</h2>
              </div>
              <button
                class="parallel-icon"
                aria-label={language.t("parallel.close")}
                onClick={() => set("selected", "")}
              >
                ×
              </button>
            </header>
            <Show when={branch().created || branch().admitted}>
              <div class="parallel-session-banner">
                <A
                  classList={{ "parallel-needs-review": parallel.requests(branch().id) > 0 }}
                  href={sessionHref(server.key, branch().sessionID)}
                >
                  {language.t(parallel.requests(branch().id) > 0 ? "parallel.review" : "parallel.fullSession")} ↗
                </A>
                <p>{language.t("parallel.fullSessionHint")}</p>
              </div>
            </Show>
            <div class="parallel-messages" aria-live="polite">
              <For each={parallel.messages(branch().id)}>
                {(message) => (
                  <div class="parallel-message" data-role={message.role}>
                    <span>{language.t(message.role === "user" ? "parallel.you" : "parallel.assistant")}</span>
                    <p>{message.text}</p>
                  </div>
                )}
              </For>
              <Show when={!parallel.messages(branch().id).length}>
                <p class="parallel-muted">{language.t("parallel.waiting")}</p>
              </Show>
              <Show when={branch().error}>
                <p class="parallel-error" role="alert">
                  {branch().error}
                </p>
              </Show>
            </div>
            <form
              class="parallel-reply"
              onSubmit={(event) => {
                event.preventDefault()
                const text = state.reply
                set("reply", "")
                void parallel.send(branch().id, text)
              }}
            >
              <textarea
                aria-label={language.t("parallel.continue")}
                placeholder={language.t("parallel.continue")}
                value={state.reply}
                onInput={(event) => set("reply", event.currentTarget.value)}
              />
              <div>
                <span class="parallel-status" data-status={branch().status}>
                  {language.t(`parallel.status.${branch().status}`)}
                </span>
                <Show
                  when={branch().status === "running" || branch().status === "queued"}
                  fallback={
                    <button class="parallel-primary" disabled={!state.reply.trim()}>
                      {language.t("parallel.send")} ↑
                    </button>
                  }
                >
                  <button type="button" class="parallel-primary" onClick={() => void parallel.cancel(branch().id)}>
                    {language.t("parallel.stop")}
                  </button>
                </Show>
              </div>
            </form>
          </aside>
        )}
      </Show>
    </main>
  )
}
