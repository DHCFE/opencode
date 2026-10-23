#!/usr/bin/env bun
import { $ } from "bun"

import { copyBuiltCliToResources, downloadCliToResources, resolveChannel } from "./utils"

const channel = resolveChannel()

if (channel === "prod" && !Bun.env.OPENCODE_CLI_DIST) {
  throw new Error("OPENCODE_CLI_DIST is required for production desktop builds")
}

await $`bun ./scripts/copy-icons.ts ${channel}`

await $`bun ./scripts/copy-metainfo.ts ${channel}`

// A fork must bundle its own backend even when it uses the development channel.
if (Bun.env.OPENCODE_CLI_DIST) await copyBuiltCliToResources(Bun.env.OPENCODE_CLI_DIST)
else if (channel === "dev") await downloadCliToResources()
else if (channel === "beta") await downloadCliToResources("beta")
