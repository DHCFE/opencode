import { createSimpleContext } from "@opencode/ui/context"
import { Show, type ParentProps } from "solid-js"
import { ServerProvider } from "@/runtime/server/current"
import { useServers } from "@/runtime/server/registry"
import { createParallel } from "./controller"

const context = createSimpleContext({ name: "Parallel", gate: false, init: createParallel })

export const useParallel = context.use

// Keep the scheduler alive while a branch is open in the full session interface.
export function ParallelProvider(props: ParentProps) {
  const servers = useServers()
  return (
    <Show when={servers.visible[0]} keyed>
      {(conn) => (
        <ServerProvider conn={conn}>
          <context.provider>{props.children}</context.provider>
        </ServerProvider>
      )}
    </Show>
  )
}
