type Job = { id: string; run: () => Promise<void>; resolve: () => void; reject: (error: unknown) => void }

/** Two in-flight sessions per panel, including time spent streaming. */
export function createParallelQueue() {
  const pending: Job[] = []
  const active = new Set<string>()

  function pump() {
    while (active.size < 2 && pending.length) {
      const job = pending.shift()!
      active.add(job.id)
      void Promise.resolve()
        .then(job.run)
        .then(job.resolve, job.reject)
        .finally(() => {
          active.delete(job.id)
          pump()
        })
    }
  }

  return {
    busy(id: string) {
      return active.has(id) || pending.some((job) => job.id === id)
    },
    add(id: string, run: () => Promise<void>) {
      const result = Promise.withResolvers<void>()
      pending.push({ id, run, resolve: result.resolve, reject: result.reject })
      pump()

      return result.promise
    },
    cancel(id: string) {
      const index = pending.findIndex((job) => job.id === id)

      if (index < 0) return
      pending.splice(index, 1)[0].resolve()
    },
    clear() {
      pending.splice(0).forEach((job) => job.resolve())
    },
  }
}
