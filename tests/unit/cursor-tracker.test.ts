// Unit tests for src/capture/cursor-tracker.ts
// Mocks Playwright Page to test tracking state and event collection.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { CursorTracker } from "../../src/capture/cursor-tracker.js";

function mockPage() {
  return {
    exposeFunction: vi.fn(),
    addInitScript: vi.fn(),
  };
}

describe("CursorTracker", () => {
  let tracker: CursorTracker;

  beforeEach(() => {
    tracker = new CursorTracker();
  });

  it("initializes with isTracking=false", () => {
    expect(tracker.isTracking()).toBe(false);
  });

  it("initializes with empty events (flushEvents returns [])", () => {
    expect(tracker.flushEvents()).toEqual([]);
  });

  it("startTracking sets isTracking=true", async () => {
    const page = mockPage();
    await tracker.startTracking(page as any);
    expect(tracker.isTracking()).toBe(true);
  });

  it("startTracking calls page.exposeFunction", async () => {
    const page = mockPage();
    await tracker.startTracking(page as any);
    expect(page.exposeFunction).toHaveBeenCalledWith("__cursorTrack__", expect.any(Function));
  });

  it("startTracking calls page.addInitScript", async () => {
    const page = mockPage();
    await tracker.startTracking(page as any);
    expect(page.addInitScript).toHaveBeenCalledOnce();
  });

  it("stopTracking sets isTracking=false and returns events", async () => {
    const page = mockPage();
    await tracker.startTracking(page as any);

    // Simulate events via the exposed callback
    const callback = page.exposeFunction.mock.calls[0][1];
    callback({ timestamp: 100, x: 10, y: 20, type: "click" });
    callback({ timestamp: 200, x: 30, y: 40, type: "move" });

    const events = tracker.stopTracking();
    expect(tracker.isTracking()).toBe(false);
    expect(events).toHaveLength(2);
    expect(events[0]).toEqual({ timestamp: 100, x: 10, y: 20, type: "click" });
  });

  it("exposed callback pushes events when tracking is active", async () => {
    const page = mockPage();
    await tracker.startTracking(page as any);

    const callback = page.exposeFunction.mock.calls[0][1];
    callback({ timestamp: 1, x: 0, y: 0, type: "scroll" });

    expect(tracker.flushEvents()).toHaveLength(1);
  });

  it("exposed callback ignores events after stopTracking", async () => {
    const page = mockPage();
    await tracker.startTracking(page as any);

    const callback = page.exposeFunction.mock.calls[0][1];
    callback({ timestamp: 1, x: 0, y: 0, type: "click" });
    tracker.stopTracking();

    // Flush existing events first
    tracker.flushEvents();

    // Event sent after stop should be ignored
    callback({ timestamp: 2, x: 5, y: 5, type: "move" });
    expect(tracker.flushEvents()).toHaveLength(0);
  });

  it("flushEvents returns events and clears buffer", async () => {
    const page = mockPage();
    await tracker.startTracking(page as any);

    const callback = page.exposeFunction.mock.calls[0][1];
    callback({ timestamp: 1, x: 10, y: 20, type: "click" });
    callback({ timestamp: 2, x: 30, y: 40, type: "move" });

    const first = tracker.flushEvents();
    expect(first).toHaveLength(2);

    const second = tracker.flushEvents();
    expect(second).toHaveLength(0);
  });

  it("stopTracking returns copy of events (not reference)", async () => {
    const page = mockPage();
    await tracker.startTracking(page as any);

    const callback = page.exposeFunction.mock.calls[0][1];
    callback({ timestamp: 1, x: 0, y: 0, type: "click" });

    const events = tracker.stopTracking();
    expect(events).toHaveLength(1);
    // Internal buffer was not cleared by stopTracking, but flushEvents should still work
    const flushed = tracker.flushEvents();
    // stopTracking doesn't clear — it returns a copy
    expect(flushed).toHaveLength(1);
  });
});
