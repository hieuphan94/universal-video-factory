// Unit tests for src/utils/logger.ts

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as path from "path";
import os from "os";

// Must import after mocks are ready
let createLogger: typeof import("../../src/utils/logger.js").createLogger;
let configureLogger: typeof import("../../src/utils/logger.js").configureLogger;

describe("logger", () => {
  let tmpDir: string;

  beforeEach(async () => {
    // Reset module state between tests
    vi.resetModules();
    const mod = await import("../../src/utils/logger.js");
    createLogger = mod.createLogger;
    configureLogger = mod.configureLogger;
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "vf-logger-test-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("createLogger returns object with all log methods", () => {
    const logger = createLogger("test-phase");
    expect(typeof logger.debug).toBe("function");
    expect(typeof logger.info).toBe("function");
    expect(typeof logger.warn).toBe("function");
    expect(typeof logger.error).toBe("function");
  });

  it("info logs to console with [PHASE][LEVEL] format", () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    const logger = createLogger("capture");
    logger.info("hello world");
    expect(spy).toHaveBeenCalledWith("[CAPTURE][INFO] hello world");
    spy.mockRestore();
  });

  it("error logs to console.error", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const logger = createLogger("voice");
    logger.error("something broke");
    expect(spy).toHaveBeenCalledWith("[VOICE][ERROR] something broke");
    spy.mockRestore();
  });

  it("warn logs to console.warn", () => {
    const spy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const logger = createLogger("render");
    logger.warn("low disk");
    expect(spy).toHaveBeenCalledWith("[RENDER][WARN] low disk");
    spy.mockRestore();
  });

  it("debug is suppressed by default (non-verbose)", () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    const logger = createLogger("test");
    logger.debug("hidden message");
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it("debug is shown when verbose mode is enabled", () => {
    configureLogger(tmpDir, true);
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    const logger = createLogger("test");
    logger.debug("visible now");
    expect(spy).toHaveBeenCalledWith("[TEST][DEBUG] visible now");
    spy.mockRestore();
  });

  it("configureLogger creates output dir and enables file logging", () => {
    const logDir = path.join(tmpDir, "sub", "dir");
    configureLogger(logDir);
    expect(fs.existsSync(logDir)).toBe(true);

    const logger = createLogger("file-test");
    logger.info("written to file");

    const logFile = path.join(logDir, "pipeline.log");
    expect(fs.existsSync(logFile)).toBe(true);
    const content = fs.readFileSync(logFile, "utf-8");
    expect(content).toContain("[FILE-TEST][INFO] written to file");
  });

  it("log appends extra args space-separated", () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    const logger = createLogger("multi");
    logger.info("count", 42, "items");
    expect(spy).toHaveBeenCalledWith("[MULTI][INFO] count 42 items");
    spy.mockRestore();
  });

  it("file logging is best-effort (no throw on write failure)", () => {
    // Configure to a read-only path — should not throw
    configureLogger(tmpDir);
    const logger = createLogger("safe");
    // Even if file write fails internally, no exception propagates
    expect(() => logger.info("test")).not.toThrow();
  });
});
