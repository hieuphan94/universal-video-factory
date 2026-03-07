// Unit tests for src/server/websocket-hub.ts

import { describe, it, expect, vi, beforeEach } from "vitest";
import { WebSocket } from "ws";

// Re-import fresh module each test to reset client set
let addClient: typeof import("../../src/server/websocket-hub.js").addClient;
let broadcast: typeof import("../../src/server/websocket-hub.js").broadcast;
let getClientCount: typeof import("../../src/server/websocket-hub.js").getClientCount;

describe("websocket-hub", () => {
  beforeEach(async () => {
    vi.resetModules();
    const mod = await import("../../src/server/websocket-hub.js");
    addClient = mod.addClient;
    broadcast = mod.broadcast;
    getClientCount = mod.getClientCount;
  });

  function makeMockWs(readyState = WebSocket.OPEN) {
    const handlers: Record<string, Function[]> = {};
    return {
      readyState,
      send: vi.fn(),
      on: vi.fn((event: string, cb: Function) => {
        handlers[event] = handlers[event] || [];
        handlers[event].push(cb);
      }),
      _trigger: (event: string) => {
        for (const cb of handlers[event] || []) cb();
      },
    } as unknown as WebSocket & { _trigger: (e: string) => void };
  }

  it("addClient increments client count", () => {
    expect(getClientCount()).toBe(0);
    addClient(makeMockWs());
    expect(getClientCount()).toBe(1);
  });

  it("client removed on close event", () => {
    const ws = makeMockWs();
    addClient(ws);
    expect(getClientCount()).toBe(1);
    ws._trigger("close");
    expect(getClientCount()).toBe(0);
  });

  it("client removed on error event", () => {
    const ws = makeMockWs();
    addClient(ws);
    ws._trigger("error");
    expect(getClientCount()).toBe(0);
  });

  it("broadcast sends JSON to all OPEN clients", () => {
    const ws1 = makeMockWs(WebSocket.OPEN);
    const ws2 = makeMockWs(WebSocket.OPEN);
    addClient(ws1);
    addClient(ws2);

    broadcast({ type: "progress", percent: 50 });

    const expected = JSON.stringify({ type: "progress", percent: 50 });
    expect((ws1 as any).send).toHaveBeenCalledWith(expected);
    expect((ws2 as any).send).toHaveBeenCalledWith(expected);
  });

  it("broadcast skips clients not in OPEN state", () => {
    const wsOpen = makeMockWs(WebSocket.OPEN);
    const wsClosed = makeMockWs(WebSocket.CLOSED);
    addClient(wsOpen);
    addClient(wsClosed);

    broadcast({ type: "test" });

    expect((wsOpen as any).send).toHaveBeenCalled();
    expect((wsClosed as any).send).not.toHaveBeenCalled();
  });

  it("broadcast with no clients does not throw", () => {
    expect(() => broadcast({ type: "noop" })).not.toThrow();
  });

  it("getClientCount returns correct count with multiple clients", () => {
    addClient(makeMockWs());
    addClient(makeMockWs());
    addClient(makeMockWs());
    expect(getClientCount()).toBe(3);
  });
});
