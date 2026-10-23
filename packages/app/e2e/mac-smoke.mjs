import { _electron, expect } from "@playwright/test"
import { mkdir, mkdtemp, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"

if (process.platform !== "darwin") throw new Error("The native acceptance smoke requires macOS")
if (!process.env.OPENCODE_MAC_EXECUTABLE) throw new Error("OPENCODE_MAC_EXECUTABLE is required")
const output = process.env.OPENCODE_MAC_EVIDENCE ?? "artifacts"
await mkdir(output, { recursive: true })
const root = await mkdtemp(path.join(tmpdir(), "opencode-parallel-acceptance-"))
const app = await _electron.launch({
  executablePath: process.env.OPENCODE_MAC_EXECUTABLE,
  env: { ...process.env, OPENCODE_DESKTOP_TEST_ROOT: root, LANG: "en_US.UTF-8" },
  timeout: 120_000,
})
const failures = []
try {
  const page = await app.firstWindow({ timeout: 120_000 })
  page.on("pageerror", (error) => failures.push(error.message))
  await expect(page.locator(".parallel-workspace")).toBeVisible({ timeout: 120_000 })
  await expect(page.getByRole("button", { name: /Sign in with ChatGPT|使用 ChatGPT 登录/ }).first()).toBeVisible()
  await expect(page.locator("#parallel-prompt")).toBeEditable()
  await page.screenshot({ path: path.join(output, "mac-parallel-overview.png") })
  await page
    .getByRole("button", { name: /Sign in with ChatGPT|使用 ChatGPT 登录/ })
    .first()
    .click()
  await expect(page.getByRole("dialog")).toBeVisible()
  await expect(page.getByRole("dialog")).toContainText("ChatGPT")
  await page.screenshot({ path: path.join(output, "mac-chatgpt-connect.png") })
  expect(failures).toEqual([])
  await writeFile(
    path.join(output, "mac-smoke.json"),
    JSON.stringify(
      {
        platform: process.platform,
        arch: process.arch,
        packagedAppStarted: true,
        parallelUI: true,
        providerDialog: true,
        accountAuthorization: "not performed",
        modelInference: "not performed",
        pageErrors: failures,
      },
      null,
      2,
    ),
  )
} finally {
  await app.close()
}
