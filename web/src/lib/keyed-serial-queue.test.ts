import { describe, expect, it } from "vitest"
import { createKeyedSerialQueue } from "@/lib/keyed-serial-queue"

describe("同文件保存串行队列", () => {
  it("同一个 key 必须等待前一个任务完成", async () => {
    const { enqueue } = createKeyedSerialQueue()
    const events: string[] = []
    let releaseFirst: (() => void) | undefined

    const first = enqueue("skills/fire.yml", async () => {
      events.push("first:start")
      await new Promise<void>((resolve) => {
        releaseFirst = resolve
      })
      events.push("first:end")
    })
    const second = enqueue("skills/fire.yml", async () => {
      events.push("second:start")
    })

    await Promise.resolve()
    expect(events).toEqual(["first:start"])
    releaseFirst?.()
    await Promise.all([first, second])
    expect(events).toEqual(["first:start", "first:end", "second:start"])
  })

  it("前一个任务失败后仍继续执行后续任务", async () => {
    const { enqueue } = createKeyedSerialQueue()
    const events: string[] = []

    const failed = enqueue("same.yml", async () => {
      events.push("failed")
      throw new Error("save failed")
    })
    const next = enqueue("same.yml", async () => {
      events.push("next")
    })

    await expect(failed).rejects.toThrow("save failed")
    await next
    expect(events).toEqual(["failed", "next"])
  })

  it("生命周期操作可等待匹配 key 的全部队列清空", async () => {
    const queue = createKeyedSerialQueue()
    let release: (() => void) | undefined
    let drained = false
    const pending = queue.enqueue("workspace:skills/fire.yml", async () => {
      await new Promise<void>((resolve) => {
        release = resolve
      })
    })
    const waiting = queue.waitForMatching((key) => key.startsWith("workspace:skills/"))
      .then(() => { drained = true })

    await Promise.resolve()
    expect(drained).toBe(false)
    release?.()
    await Promise.all([pending, waiting])
    expect(drained).toBe(true)
  })

  it("不同 key 可以并行开始", async () => {
    const { enqueue } = createKeyedSerialQueue()
    const events: string[] = []
    let release: (() => void) | undefined

    const first = enqueue("a.yml", async () => {
      events.push("a")
      await new Promise<void>((resolve) => {
        release = resolve
      })
    })
    const second = enqueue("b.yml", async () => {
      events.push("b")
    })

    await Promise.resolve()
    expect(events).toEqual(["a", "b"])
    release?.()
    await Promise.all([first, second])
  })
})
