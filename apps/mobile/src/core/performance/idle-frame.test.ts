import { describe, expect, test } from "bun:test";

import { type IdleFrameScheduler, scheduleAfterIdleFrame } from "./idle-frame";

class FakeScheduler implements IdleFrameScheduler {
  private nextHandle = 1;
  readonly idleCallbacks = new Map<number, () => void>();
  readonly frameCallbacks = new Map<number, () => void>();
  readonly canceledIdle: number[] = [];
  readonly canceledFrames: number[] = [];

  requestIdle(callback: () => void): number {
    const handle = this.nextHandle++;
    this.idleCallbacks.set(handle, callback);
    return handle;
  }

  cancelIdle(handle: number): void {
    this.canceledIdle.push(handle);
    this.idleCallbacks.delete(handle);
  }

  requestFrame(callback: () => void): number {
    const handle = this.nextHandle++;
    this.frameCallbacks.set(handle, callback);
    return handle;
  }

  cancelFrame(handle: number): void {
    this.canceledFrames.push(handle);
    this.frameCallbacks.delete(handle);
  }

  runIdle(handle = 1): void {
    const callback = this.idleCallbacks.get(handle);
    this.idleCallbacks.delete(handle);
    callback?.();
  }

  runFrame(handle = 2): void {
    const callback = this.frameCallbacks.get(handle);
    this.frameCallbacks.delete(handle);
    callback?.();
  }
}

describe("idle frame scheduling", () => {
  test("runs work on the frame after the runtime becomes idle", () => {
    const scheduler = new FakeScheduler();
    let calls = 0;

    scheduleAfterIdleFrame(() => calls++, scheduler);
    expect(calls).toBe(0);

    scheduler.runIdle();
    expect(calls).toBe(0);

    scheduler.runFrame();
    expect(calls).toBe(1);
  });

  test("cancels before the idle callback", () => {
    const scheduler = new FakeScheduler();
    let calls = 0;
    const cancel = scheduleAfterIdleFrame(() => calls++, scheduler);

    cancel();
    scheduler.runIdle();
    scheduler.runFrame();

    expect(calls).toBe(0);
    expect(scheduler.canceledIdle).toEqual([1]);
    expect(scheduler.canceledFrames).toEqual([]);
  });

  test("cancels a frame that was queued after the idle callback", () => {
    const scheduler = new FakeScheduler();
    let calls = 0;
    const cancel = scheduleAfterIdleFrame(() => calls++, scheduler);

    scheduler.runIdle();
    cancel();
    scheduler.runFrame();

    expect(calls).toBe(0);
    expect(scheduler.canceledFrames).toEqual([2]);
  });
});
