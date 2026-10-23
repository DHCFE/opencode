import { chromium, expect } from "@playwright/test"
import { spawn } from "node:child_process"
import { mkdir, mkdtemp, writeFile } from "node:fs/promises"
import { createServer } from "node:net"
import { tmpdir } from "node:os"
import path from "node:path"

if (process.platform !== "darwin") throw new Error("The native acceptance smoke requires macOS")
if (!process.env.OPENCODE_MAC_EXECUTABLE) throw new Error("OPENCODE_MAC_EXECUTABLE is required")
const output = process.env.OPENCODE_MAC_EVIDENCE ?? "artifacts"
await mkdir(output, { recursive: true })
const root = await mkdtemp(path.join(tmpdir(), "opencode-parallel-acceptance-"))
const server = createServer()
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve))
const port = server.address().port
await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())))

// Exercise the packaged executable through its renderer protocol. A main-process
// inspector is unnecessary and can stall Electron automation.
const app = spawn(process.env.OPENCODE_MAC_EXECUTABLE, [`--remote-debugging-port=${port}`], {
  env: { ...process.env, OPENCODE_DESKTOP_TEST_ROOT: root, LANG: "en_US.UTF-8" },
  stdio: ["ignore", "pipe", "pipe"],
})
let log = ""
for (const stream of [app.stdout, app.stderr]) {
  stream.on("data", (data) => {
    log += data.toString()
    process.stdout.write(data)
  })
}
app.on("error", (error) => {
  log += error.stack
  console.error(error)
})
const watchdog = setTimeout(() => {
  console.error("Native acceptance exceeded three minutes")
  app.kill("SIGKILL")
  process.exit(1)
}, 180_000)
const result = {
  platform: process.platform,
  arch: process.arch,
  packagedAppStarted: false,
  parallelUI: false,
  providerDialog: false,
  accountAuthorization: "not performed",
  modelInference: "not performed",
  pageErrors: [],
}
let browser
let page
try {
  console.log("Waiting for packaged App renderer")
  await expect
    .poll(
      () =>
        fetch(`http://127.0.0.1:${port}/json/version`)
          .then((response) => response.ok)
          .catch(() => false),
      {
        timeout: 120_000,
      },
    )
    .toBe(true)
  browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`, { timeout: 15_000 })
  const context = browser.contexts()[0]
  page = context.pages()[0] ?? (await context.waitForEvent("page", { timeout: 30_000 }))
  result.packagedAppStarted = true
  page.on("pageerror", (error) => result.pageErrors.push(error.message))
  console.log("Checking parallel workspace")
  await expect(page.locator(".parallel-workspace")).toBeVisible({ timeout: 120_000 })
  await expect(page.getByRole("button", { name: /Sign in with ChatGPT|使用 ChatGPT 登录/ }).first()).toBeVisible()
  await expect(page.locator("#parallel-prompt")).toBeEditable()
  result.parallelUI = true
  await page.screenshot({ path: path.join(output, "mac-parallel-overview.png"), timeout: 10_000 })
  console.log("Checking ChatGPT connection dialog")
  await page
    .getByRole("button", { name: /Sign in with ChatGPT|使用 ChatGPT 登录/ })
    .first()
    .click()
  await expect(page.getByRole("dialog")).toBeVisible()
  await expect(page.getByRole("dialog")).toContainText("ChatGPT")
  result.providerDialog = true
  await page.screenshot({ path: path.join(output, "mac-chatgpt-connect.png"), timeout: 10_000 })
  expect(result.pageErrors).toEqual([])
  console.log("Packaged Mac acceptance passed; account authorization and inference were not performed")
} catch (error) {
  result.error = error.stack ?? error.message
  await page?.screenshot({ path: path.join(output, "mac-failure.png"), timeout: 5_000 }).catch(() => {})
  throw error
} finally {
  await writeFile(path.join(output, "mac-smoke.json"), JSON.stringify(result, null, 2))
  await writeFile(path.join(output, "mac-app.log"), log)
  // The isolated test profile is disposable; don't wait on application quit UI.
  app.kill("SIGKILL")
  await browser?.close()
  clearTimeout(watchdog)
}
