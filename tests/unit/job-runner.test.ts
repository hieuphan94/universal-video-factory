// Unit tests for src/queue/job-runner.ts
// Mocks worker_threads.Worker and job-store to test runner lifecycle.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock worker_threads before importing job-runner
const mockWorkerInstance = {
  on: vi.fn(),
  terminate: vi.fn(),
  postMessage: vi.fn(),
};

vi.mock("worker_threads", () => ({
  Worker: vi.fn(() => mockWorkerInstance),
}));

vi.mock("../../src/queue/job-store.js", () => ({
  getNextQueued: vi.fn(),
  updateJob: vi.fn(),
}));

vi.mock("../../src/utils/logger.js", () => ({
  createLogger: () => ({
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  }),
}));

// Mock fs for log tailing
vi.mock("fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("fs")>();
  return {
    ...actual,
    existsSync: vi.fn(() => false),
  };
});

import {
  startRunner,
  stopRunner,
  cancelRunningJob,
  getActiveJobId,
} from "../../src/queue/job-runner.js";
import { getNextQueued, updateJob } from "../../src/queue/job-store.js";

describe("job-runner", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    // Reset on handlers for each test
    mockWorkerInstance.on.mockReset();
    mockWorkerInstance.terminate.mockReset();
  });

  afterEach(() => {
    stopRunner();
    vi.useRealTimers();
  });

  it("getActiveJobId returns null when idle", () => {
    expect(getActiveJobId()).toBeNull();
  });

  it("startRunner polls and picks up queued jobs", () => {
    const onProgress = vi.fn();
    const onCompletion = vi.fn();

    const job = {
      id: "job-1",
      config: { url: "https://example.com", feature: "test" },
    };
    vi.mocked(getNextQueued).mockReturnValueOnce(job as any);

    startRunner(onProgress, onCompletion);

    // Advance past poll interval (2000ms)
    vi.advanceTimersByTime(2100);

    expect(getNextQueued).toHaveBeenCalled();
    expect(updateJob).toHaveBeenCalledWith("job-1", expect.objectContaining({ status: "running" }));
    expect(getActiveJobId()).toBe("job-1");
  });

  it("does not start a second runner if already running", () => {
    const onProgress = vi.fn();
    const onCompletion = vi.fn();

    vi.mocked(getNextQueued).mockReturnValue(null);
    startRunner(onProgress, onCompletion);
    startRunner(onProgress, onCompletion); // second call — should be no-op

    vi.advanceTimersByTime(2100);
    // Only one poll timer active, getNextQueued called once per interval
    expect(getNextQueued).toHaveBeenCalledTimes(1);
  });

  it("Worker progress message calls onProgress and updateJob", () => {
    const onProgress = vi.fn();
    const onCompletion = vi.fn();

    const job = {
      id: "job-2",
      config: { url: "https://example.com", feature: "test" },
    };
    vi.mocked(getNextQueued).mockReturnValueOnce(job as any);

    startRunner(onProgress, onCompletion);
    vi.advanceTimersByTime(2100);

    // Find the "message" handler
    const messageHandler = mockWorkerInstance.on.mock.calls.find((c) => c[0] === "message")?.[1];
    expect(messageHandler).toBeDefined();

    messageHandler({ type: "progress", phase: "A", phaseName: "AI Director" });

    expect(onProgress).toHaveBeenCalledWith(
      "job-2",
      expect.objectContaining({ phase: "A", phaseName: "AI Director" })
    );
    expect(updateJob).toHaveBeenCalledWith(
      "job-2",
      expect.objectContaining({ progress: expect.any(Object) })
    );
  });

  it("Worker complete message sets status=completed", () => {
    const onProgress = vi.fn();
    const onCompletion = vi.fn();

    const job = {
      id: "job-3",
      config: { url: "https://example.com", feature: "test" },
    };
    vi.mocked(getNextQueued).mockReturnValueOnce(job as any);

    startRunner(onProgress, onCompletion);
    vi.advanceTimersByTime(2100);

    const messageHandler = mockWorkerInstance.on.mock.calls.find((c) => c[0] === "message")?.[1];
    messageHandler({ type: "complete", outputPath: "/out/final.mp4", elapsedMs: 5000 });

    expect(updateJob).toHaveBeenCalledWith(
      "job-3",
      expect.objectContaining({ status: "completed", outputPath: "/out/final.mp4" })
    );
    expect(onCompletion).toHaveBeenCalledWith("job-3", "completed", "/out/final.mp4");
    expect(getActiveJobId()).toBeNull();
  });

  it("Worker error message sets status=failed", () => {
    const onProgress = vi.fn();
    const onCompletion = vi.fn();

    const job = {
      id: "job-4",
      config: { url: "https://example.com", feature: "test" },
    };
    vi.mocked(getNextQueued).mockReturnValueOnce(job as any);

    startRunner(onProgress, onCompletion);
    vi.advanceTimersByTime(2100);

    const messageHandler = mockWorkerInstance.on.mock.calls.find((c) => c[0] === "message")?.[1];
    messageHandler({ type: "error", message: "TTS failed" });

    expect(updateJob).toHaveBeenCalledWith(
      "job-4",
      expect.objectContaining({ status: "failed", error: "TTS failed" })
    );
    expect(onCompletion).toHaveBeenCalledWith("job-4", "failed", "TTS failed");
    expect(getActiveJobId()).toBeNull();
  });

  it("Worker error event marks job failed", () => {
    const onProgress = vi.fn();
    const onCompletion = vi.fn();

    const job = {
      id: "job-5",
      config: { url: "https://example.com", feature: "test" },
    };
    vi.mocked(getNextQueued).mockReturnValueOnce(job as any);

    startRunner(onProgress, onCompletion);
    vi.advanceTimersByTime(2100);

    const errorHandler = mockWorkerInstance.on.mock.calls.find((c) => c[0] === "error")?.[1];
    errorHandler(new Error("Worker crashed"));

    expect(updateJob).toHaveBeenCalledWith(
      "job-5",
      expect.objectContaining({ status: "failed", error: "Worker crashed" })
    );
    expect(onCompletion).toHaveBeenCalledWith("job-5", "failed", "Worker crashed");
  });

  it("Worker exit with non-zero code marks job failed", () => {
    const onProgress = vi.fn();
    const onCompletion = vi.fn();

    const job = {
      id: "job-6",
      config: { url: "https://example.com", feature: "test" },
    };
    vi.mocked(getNextQueued).mockReturnValueOnce(job as any);

    startRunner(onProgress, onCompletion);
    vi.advanceTimersByTime(2100);

    const exitHandler = mockWorkerInstance.on.mock.calls.find((c) => c[0] === "exit")?.[1];
    exitHandler(1);

    expect(updateJob).toHaveBeenCalledWith(
      "job-6",
      expect.objectContaining({ status: "failed", error: "Worker exited with code 1" })
    );
    expect(onCompletion).toHaveBeenCalledWith("job-6", "failed", "Worker exited with code 1");
  });

  it("cancelRunningJob terminates worker and returns true", () => {
    const onProgress = vi.fn();
    const onCompletion = vi.fn();

    const job = {
      id: "job-7",
      config: { url: "https://example.com", feature: "test" },
    };
    vi.mocked(getNextQueued).mockReturnValueOnce(job as any);

    startRunner(onProgress, onCompletion);
    vi.advanceTimersByTime(2100);

    const result = cancelRunningJob("job-7");
    expect(result).toBe(true);
    expect(mockWorkerInstance.terminate).toHaveBeenCalled();
    expect(updateJob).toHaveBeenCalledWith(
      "job-7",
      expect.objectContaining({ status: "cancelled" })
    );
  });

  it("cancelRunningJob with wrong jobId returns false", () => {
    const onProgress = vi.fn();
    const onCompletion = vi.fn();

    const job = {
      id: "job-8",
      config: { url: "https://example.com", feature: "test" },
    };
    vi.mocked(getNextQueued).mockReturnValueOnce(job as any);

    startRunner(onProgress, onCompletion);
    vi.advanceTimersByTime(2100);

    const result = cancelRunningJob("wrong-id");
    expect(result).toBe(false);
    expect(mockWorkerInstance.terminate).not.toHaveBeenCalled();
  });

  it("cancelRunningJob returns false when no job is running", () => {
    expect(cancelRunningJob("any-id")).toBe(false);
  });

  it("stopRunner clears interval and terminates active worker", () => {
    const onProgress = vi.fn();
    const onCompletion = vi.fn();

    const job = {
      id: "job-9",
      config: { url: "https://example.com", feature: "test" },
    };
    vi.mocked(getNextQueued).mockReturnValueOnce(job as any);

    startRunner(onProgress, onCompletion);
    vi.advanceTimersByTime(2100);

    stopRunner();

    expect(mockWorkerInstance.terminate).toHaveBeenCalled();
    expect(getActiveJobId()).toBeNull();

    // After stop, advancing timers should not poll again
    vi.mocked(getNextQueued).mockClear();
    vi.advanceTimersByTime(5000);
    expect(getNextQueued).not.toHaveBeenCalled();
  });
});
