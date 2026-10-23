import { expect, type Page } from "@playwright/test"
import type { SessionMessageInfo, SessionStructuredError } from "@opencode/client/promise"
import { provider } from "./app"
import { assistantMessage, textPart, userMessage, userText } from "./timeline"
import { mockWorkspace } from "./workspace"
import type { MockServerConfig } from "./mock-server"

export async function openParallel(
  page: Page,
  input: Pick<MockServerConfig, "onSessionCreate" | "integrations"> & {
    error?: SessionStructuredError
    git?: boolean
  } = {},
) {
  await page.setViewportSize({ width: 1440, height: 960 })
  const creates: Record<string, unknown>[] = []
  const worktrees: unknown[] = []
  const prompts: { sessionID: string; body: Record<string, unknown> }[] = []
  const messages: Record<string, SessionMessageInfo[]> = {}
  const workspace = await mockWorkspace(page, {
    name: "Parallel",
    sessions: [],
    project: { vcs: input.git === false ? undefined : "git" },
    onWorktreeCreate(body) {
      worktrees.push(body)
    },
    integrations: input.integrations,
    provider: provider({ id: "alpha", name: "Test Alpha" }, { id: "beta", name: "Test Beta" }),
    seed: { locale: "zh", theme: { id: "oc-1", scheme: "light" } },
    onSessionCreate(body, attempt) {
      creates.push(body)
      return input.onSessionCreate?.(body, attempt)
    },
    onPrompt(prompt) {
      prompts.push(prompt)
      const history = (messages[prompt.sessionID] ??= [])
      const id = String(prompt.body.id)
      history.push(
        userMessage([userText(String(prompt.body.text))], { id }),
        assistantMessage([textPart(`prt_${id}`, `独立回答 ${prompts.length}`)], {
          id: `msg_answer_${id}`,
          parentID: id,
          error: input.error,
        }),
      )
    },
    pageMessages: (id) => ({ items: messages[id] ?? [] }),
  })
  await page.goto("/")
  await expect(page.getByRole("combobox", { name: "模型与实例" })).toHaveCount(1)
  await expect(page.getByRole("spinbutton", { name: "实例数" })).toHaveValue("2")
  return { ...workspace, creates, prompts, worktrees }
}
