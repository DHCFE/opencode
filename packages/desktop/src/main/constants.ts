import { app } from "electron"

type Channel = "local" | "dev" | "beta" | "prod"

const raw = import.meta.env.OPENCODE_CHANNEL

export const CHANNEL: Channel = raw === "local" || raw === "dev" || raw === "beta" || raw === "prod" ? raw : "dev"

export const VERSION = app.isPackaged ? app.getVersion() : (process.env.OPENCODE_VERSION ?? app.getVersion())

const appNames: Record<string, string> = {
  dev: "OpenCode Dev",
  beta: "OpenCode Beta",
  prod: "OpenCode",
}

const appIDs: Record<string, string> = {
  dev: "ai.opencode.desktop.dev",
  beta: "ai.opencode.desktop.beta",
  prod: "ai.opencode.desktop",
}

// Local renderer/server mode keeps the dev application identity.
export const APP_NAME = app.isPackaged
  ? import.meta.env.OPENCODE_PARALLEL_BUILD === "1"
    ? "OpenCode Parallel"
    : appNames[CHANNEL]
  : "OpenCode Dev"

export const APP_ID = app.isPackaged
  ? import.meta.env.OPENCODE_PARALLEL_BUILD === "1"
    ? "app.opencode.parallel"
    : appIDs[CHANNEL]
  : "ai.opencode.desktop.dev"
