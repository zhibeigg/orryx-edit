export interface KeyedSerialQueue {
  enqueue<T>(key: string, task: () => Promise<T>): Promise<T>
  waitForIdle(key: string): Promise<void>
  waitForMatching(matches: (key: string) => boolean): Promise<void>
}

export function createKeyedSerialQueue(): KeyedSerialQueue {
  const queues = new Map<string, Promise<void>>()

  const waitForMatching = async (matches: (key: string) => boolean): Promise<void> => {
    while (true) {
      const pending = [...queues.entries()]
        .filter(([key]) => matches(key))
        .map(([, tail]) => tail)
      if (pending.length === 0) return
      await Promise.all(pending)
      if (![...queues.keys()].some(matches)) return
    }
  }

  return {
    enqueue<T>(key: string, task: () => Promise<T>): Promise<T> {
      const previous = queues.get(key) ?? Promise.resolve()
      const result = previous.then(task)
      const tail = result.then(() => undefined, () => undefined)
      queues.set(key, tail)
      return result.finally(() => {
        if (queues.get(key) === tail) queues.delete(key)
      })
    },
    waitForIdle: (key) => waitForMatching((candidate) => candidate === key),
    waitForMatching,
  }
}
