import { expect, test } from "bun:test"
import { createParallelQueue } from "./queue"

test("holds two streaming slots until completion and releases a failed slot", async () => {
  const queue = createParallelQueue()
  const gates = Array.from({ length: 3 }, () => Promise.withResolvers<void>())
  const started = Array.from({ length: 3 }, () => Promise.withResolvers<void>())
  const order: number[] = []

  const jobs = gates.map((gate, index) =>
    queue.add(String(index), async () => {
      order.push(index)
      started[index].resolve()
      await gate.promise
    }),
  )

  const failure = jobs[0].catch((error: unknown) => error)
  await Promise.all([started[0].promise, started[1].promise])
  expect(order).toEqual([0, 1])
  expect(queue.busy("2")).toBe(true)
  gates[0].reject(new Error("provider unavailable"))
  await started[2].promise
  expect(order).toEqual([0, 1, 2])
  expect(await failure).toEqual(new Error("provider unavailable"))
  gates[1].resolve()
  gates[2].resolve()
  await Promise.all(jobs.slice(1))
})

test("cancels queued work without releasing an active streaming slot", async () => {
  const queue = createParallelQueue()
  const gate = Promise.withResolvers<void>()
  const started = Promise.withResolvers<void>()
  const order: string[] = []

  const first = queue.add("first", async () => {
    order.push("first")
    await gate.promise
  })

  const second = queue.add("second", async () => {
    order.push("second")
    started.resolve()
    await gate.promise
  })

  const cancelled = queue.add("cancelled", async () => {
    order.push("cancelled")
  })
  const cleared = queue.add("cleared", async () => {
    order.push("cleared")
  })
  await started.promise
  queue.cancel("first")
  queue.cancel("cancelled")
  expect(queue.busy("first")).toBe(true)
  expect(queue.busy("cancelled")).toBe(false)
  queue.clear()
  await Promise.all([cancelled, cleared])
  expect(order).toEqual(["first", "second"])
  gate.resolve()
  await Promise.all([first, second])
})
