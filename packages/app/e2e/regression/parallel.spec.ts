import { expect, test } from "@playwright/test"
import { holdRoute } from "../utils/app"
import { openParallel } from "../utils/parallel"

test("multiple model instances keep independent conversations and persist branch order", async ({ page }) => {
  const mock = await openParallel(page)
  await page.getByLabel("你的问题", { exact: true }).fill("为一个极简数学学习工具提出三种思路。")
  await page.getByLabel("Agent", { exact: true }).selectOption("build")
  await page.getByRole("button", { name: "添加模型" }).click()
  await page
    .getByRole("combobox", { name: "模型与实例" })
    .nth(1)
    .selectOption(JSON.stringify(["opencode", "beta"]))
  await page.getByRole("button", { name: "开始并行" }).click()
  const branches = page.getByRole("region", { name: "分支总览" }).getByRole("article")
  await expect(branches).toHaveCount(3)
  await expect.poll(() => mock.prompts.length).toBe(3)
  await expect(branches.getByText("已完成", { exact: true })).toHaveCount(3)
  expect(new Set(mock.prompts.map((prompt) => prompt.sessionID)).size).toBe(3)
  expect(mock.creates.map((body) => body.model)).toEqual([
    { id: "alpha", providerID: "opencode" },
    { id: "alpha", providerID: "opencode" },
    { id: "beta", providerID: "opencode" },
  ])
  expect(mock.worktrees).toHaveLength(3)
  expect(new Set(mock.creates.map((body) => (body.location as { directory: string }).directory)).size).toBe(3)
  expect(mock.creates.every((body) => !("permissions" in body) && body.agent === "build")).toBe(true)
  const firstAnswer = await branches.nth(0).locator(".parallel-branch-open p").innerText()
  const secondAnswer = await branches.nth(1).locator(".parallel-branch-open p").innerText()
  const firstSession = (await branches.nth(0).getByRole("link", { name: "打开完整会话" }).getAttribute("href"))!
    .split("/")
    .at(-1)
  await branches.nth(0).getByRole("button", { name: "展开对话 · Test Alpha · 1", exact: true }).click()
  const detail = page.getByRole("complementary", { name: "分支 · Test Alpha", exact: true })
  await expect(detail).toContainText(firstAnswer)
  await detail.getByRole("textbox", { name: "继续对话…" }).fill("只继续这个分支。")
  await detail.getByRole("button", { name: "发送" }).click()
  await expect.poll(() => mock.prompts.length).toBe(4)
  await expect(detail).toContainText("独立回答 4")
  expect(mock.prompts[3].sessionID).toBe(firstSession)
  await expect(branches.nth(1)).toContainText(secondAnswer)
  await detail.getByRole("button", { name: "关闭对话" }).click()
  await branches.nth(2).getByRole("button", { name: "上移", exact: true }).click()
  await expect(branches.nth(1)).toContainText("Test Beta")
  await branches.nth(1).locator('[draggable="true"]').dragTo(branches.nth(0))
  await expect(branches.nth(0)).toContainText("Test Beta")
  await page.locator(".parallel-workspace").evaluate((element) => {
    element.scrollTop = 0
  })
  await page.screenshot({ path: test.info().outputPath("parallel-overview.png"), fullPage: true })
  await page.reload()
  await expect(branches).toHaveCount(3)
  await expect(branches.nth(0)).toContainText("Test Beta")
  await expect(branches.nth(1)).toContainText("独立回答 4")
  expect(mock.prompts).toHaveLength(4)
  await branches.nth(0).getByRole("link", { name: "打开完整会话" }).click()
  await expect(page.locator('[data-component="composer-editor"]')).toBeEditable()
  await expect(page).toHaveURL(/\/session\//)
  const fullSession = (await page.url()).split("/").at(-1)
  const held = await holdRoute(page, /\/api\/experimental\/session\/[^/?]+\/wait(?:\?|$)/, { method: "POST" })
  await mock.push([
    {
      id: "evt_full_session_started",
      created: Date.now(),
      type: "session.execution.started",
      data: { sessionID: fullSession },
    },
  ])
  await held.arrived
  await page.goBack()
  await expect(branches).toHaveCount(3)
  await expect(branches.nth(0)).toContainText("思考中")
  held.release()
  await expect(branches.nth(0)).toContainText("已完成")
  expect(mock.prompts).toHaveLength(4)
})

test("live SSE output is visible before completion and queued or active branches can be stopped", async ({ page }) => {
  const mock = await openParallel(page)
  const held = await holdRoute(page, /\/api\/experimental\/session\/[^/?]+\/wait(?:\?|$)/, { method: "POST" })
  await page.getByLabel("你的问题", { exact: true }).fill("解释如何从不同角度理解同一个问题。")
  await page.getByRole("spinbutton", { name: "实例数" }).fill("3")
  await page.getByRole("button", { name: "开始并行" }).click()
  const branches = page.getByRole("region", { name: "分支总览" }).getByRole("article")
  await held.arrived
  await expect.poll(() => mock.prompts.length).toBe(2)
  await expect(branches.nth(2)).toContainText("等待中")
  const sessionID = String(mock.creates[0].id)
  const activeBranch = branches.filter({ has: page.locator(`a[href$="/session/${sessionID}"]`) })
  const directory = (mock.creates[0].location as { directory: string }).directory
  const common = { sessionID, assistantMessageID: "msg_parallel_stream" }
  await mock.push([
    {
      id: "evt_parallel_1",
      created: Date.now(),
      type: "session.step.started",
      location: { directory },
      durable: { aggregateID: sessionID, seq: 1, version: 1 },
      data: { ...common, agent: "build", model: { id: "alpha", providerID: "opencode" }, started: Date.now() },
    },
    {
      id: "evt_parallel_2",
      created: Date.now(),
      type: "session.text.started",
      location: { directory },
      durable: { aggregateID: sessionID, seq: 2, version: 1 },
      data: { ...common, ordinal: 0 },
    },
    {
      id: "evt_parallel_3",
      created: Date.now(),
      type: "session.text.delta",
      location: { directory },
      data: { ...common, ordinal: 0, delta: "正在逐步展开的回答" },
    },
  ])
  await expect(activeBranch).toContainText("正在逐步展开的回答")
  await expect(activeBranch).toContainText("思考中")
  await branches.nth(2).getByRole("button", { name: "停止", exact: true }).click()
  await expect(branches.nth(2)).toContainText("已停止")
  const interrupted = page.waitForRequest(
    (request) => request.method() === "POST" && request.url().includes(`/session/${sessionID}/interrupt`),
  )
  await activeBranch.getByRole("button", { name: "停止", exact: true }).click()
  await interrupted
  await expect(activeBranch).toContainText("已停止")
  held.release()
  await expect(branches.getByText("已完成", { exact: true })).toHaveCount(1)
  expect(mock.prompts).toHaveLength(2)
})

test("session creation failures are shown per branch while other instances complete", async ({ page }) => {
  await openParallel(page, {
    onSessionCreate: (_, attempt) =>
      attempt === 1 ? { status: 500, body: { message: "Provider unavailable" } } : undefined,
  })
  await page.getByLabel("你的问题", { exact: true }).fill("检验每个分支的错误状态。")
  await page.getByRole("button", { name: "开始并行" }).click()
  const branches = page.getByRole("region", { name: "分支总览" }).getByRole("article")
  await expect(branches.getByText("失败", { exact: true })).toHaveCount(1)
  await expect(branches.getByText("已完成", { exact: true })).toHaveCount(1)
  await expect(branches.getByText("独立回答 1", { exact: true })).toHaveCount(1)
})

test("a provider usage limit stops unsent instances without automatic retry", async ({ page }) => {
  const mock = await openParallel(page, {
    error: {
      type: "APIError",
      status: 429,
      message: "Plan limit reached",
      response: { body: '{"code":"subscription_sharing_usage_limit_exceeded"}' },
    },
  })
  await page.getByLabel("你的问题", { exact: true }).fill("尊重提供商限额。")
  await page.getByRole("spinbutton", { name: "实例数" }).fill("3")
  await page.getByRole("button", { name: "开始并行" }).click()
  const branches = page.getByRole("region", { name: "分支总览" }).getByRole("article")
  await expect(branches.nth(0)).toContainText("subscription_sharing_usage_limit_exceeded")
  await expect(branches.nth(2)).toContainText("已停止")
  await expect(branches.nth(2)).toContainText("限额")
  expect(mock.creates).toHaveLength(2)
  expect(mock.prompts).toHaveLength(2)
})

test("non-Git projects cannot start file-editing agents in a shared directory", async ({ page }) => {
  const mock = await openParallel(page, { git: false })
  await page.getByLabel("你的问题", { exact: true }).fill("不要让分支共享写入目录。")
  await page.getByRole("button", { name: "开始并行" }).click()
  await expect(page.getByRole("alert")).toContainText("Git")
  expect(mock.worktrees).toHaveLength(0)
  expect(mock.creates).toHaveLength(0)
})

test("the main panel opens the upstream ChatGPT sign-in flow without claiming authorization", async ({ page }) => {
  await openParallel(page, {
    integrations: [
      {
        id: "openai",
        name: "OpenAI",
        connections: [],
        methods: [
          { id: "chatgpt-token-sharing", type: "oauth", label: "Sign in with ChatGPT" },
          { type: "key", label: "API key" },
        ],
      },
    ],
  })
  await page.getByRole("button", { name: "使用 ChatGPT 登录", exact: true }).first().click()
  const dialog = page.getByRole("dialog")
  await expect(dialog).toBeVisible()
  await expect(dialog).toContainText("ChatGPT")
  await expect(dialog).toContainText("API")
})
