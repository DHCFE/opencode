import type { Configuration } from "electron-builder"
import { getConfig } from "./electron-builder.config"

// Internal acceptance build. Developer ID signing and notarization require the
// distributor's Apple credentials; never inherit upstream publishing settings.
export function getParallelConfig(): Configuration {
  if (process.env.OPENCODE_CHANNEL && process.env.OPENCODE_CHANNEL !== "dev")
    throw new Error("Parallel acceptance builds require OPENCODE_CHANNEL=dev")
  const config = getConfig()
  return {
    ...config,
    appId: "app.opencode.parallel",
    productName: "OpenCode Parallel",
    artifactName: "opencode-parallel-${os}-${arch}.${ext}",
    publish: null,
    protocols: { name: "OpenCode Parallel", schemes: ["opencode-parallel"] },
    mac: { ...config.mac, identity: "-", notarize: false },
  }
}

export default getParallelConfig()
