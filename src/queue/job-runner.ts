// Job runner — polls queue, spawns worker threads, relays progress and log lines

import { Worker } from "worker_threads";
import * as path from "path";
import * as fs from "fs";
import { fileURLToPath } from "url";
import { getNextQueued, updateJob } from "./job-store.js";
import type { WorkerMessage, JobProgress } from "./types.js";
import { createLogger } from "../utils/logger.js";

const log = createLogger("runner");

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WORKER_PATH = path.join(__dirname, "job-worker.js");
const POLL_INTERVAL_MS = 2000;
/** How often to poll the log file for new lines while a job is running */
const LOG_TAIL_INTERVAL_MS = 500;

type ProgressCallback = (jobId: string, progress: JobProgress) => void;
type CompletionCallback = (jobId: string, status: "completed" | "failed", detail: string) => void;
type LogCallback = (jobId: string, line: string) => void;

let activeWorker: Worker | null = null;
let activeJobId: string | null = null;
let pollTimer: ReturnType<typeof setInterval> | null = null;
let logTailTimer: ReturnType<typeof setInterval> | null = null;

/** Start the queue runner — polls for queued jobs and runs them */
export function startRunner(
  onProgress: ProgressCallback,
  onCompletion: CompletionCallback,
  onLog?: LogCallback
): void {
  if (pollTimer) return; // already running

  pollTimer = setInterval(() => {
    if (activeWorker) return; // one job at a time

    const job = getNextQueued();
    if (!job) return;

    activeJobId = job.id;
    const now = new Date().toISOString();
    updateJob(job.id, { status: "running", startedAt: now });

    log.info(`Starting job ${job.id}: ${job.config.url} — "${job.config.feature}"`);

    activeWorker = new Worker(WORKER_PATH, {
      workerData: { config: job.config, preview: false },
    });

    // Start tailing the log file for this job
    if (onLog) {
      startLogTail(job.id, onLog);
    }

    // Phase weights for overall percent calculation
    const phasePercent: Record<string, number> = { A: 10, B: 30, C: 15, D: 35, E: 10 };
    let currentPercent = 0;

    activeWorker.on("message", (msg: WorkerMessage) => {
      if (msg.type === "progress") {
        const phaseWeight = phasePercent[msg.phase] ?? 10;
        currentPercent = Math.min(currentPercent + phaseWeight, 95);
        const progress: JobProgress = {
          phase: msg.phase,
          phaseName: msg.phaseName,
          percent: currentPercent,
        };
        updateJob(job.id, { progress });
        onProgress(job.id, progress);
      }

      if (msg.type === "complete") {
        updateJob(job.id, {
          status: "completed",
          outputPath: msg.outputPath,
          completedAt: new Date().toISOString(),
          progress: { phase: "E", phaseName: "Complete", percent: 100 },
        });
        onCompletion(job.id, "completed", msg.outputPath);
        stopLogTail();
        cleanupWorker();
      }

      if (msg.type === "error") {
        updateJob(job.id, {
          status: "failed",
          error: msg.message,
          completedAt: new Date().toISOString(),
        });
        onCompletion(job.id, "failed", msg.message);
        stopLogTail();
        cleanupWorker();
      }
    });

    activeWorker.on("error", (err) => {
      log.error(`Worker error for job ${job.id}: ${err.message}`);
      updateJob(job.id, {
        status: "failed",
        error: err.message,
        completedAt: new Date().toISOString(),
      });
      onCompletion(job.id, "failed", err.message);
      stopLogTail();
      cleanupWorker();
    });

    activeWorker.on("exit", (code) => {
      if (code !== 0 && activeJobId === job.id) {
        log.error(`Worker exited with code ${code} for job ${job.id}`);
        updateJob(job.id, {
          status: "failed",
          error: `Worker exited with code ${code}`,
          completedAt: new Date().toISOString(),
        });
        onCompletion(job.id, "failed", `Worker exited with code ${code}`);
      }
      stopLogTail();
      cleanupWorker();
    });
  }, POLL_INTERVAL_MS);

  log.info("Queue runner started");
}

/** Tail the pipeline.log for a job and emit new lines via onLog callback */
function startLogTail(jobId: string, onLog: LogCallback): void {
  const logPath = path.resolve("output", jobId, "pipeline.log");
  let bytesRead = 0;

  logTailTimer = setInterval(() => {
    if (!fs.existsSync(logPath)) return;

    const stat = fs.statSync(logPath);
    if (stat.size <= bytesRead) return;

    const buf = Buffer.alloc(stat.size - bytesRead);
    const fd = fs.openSync(logPath, "r");
    fs.readSync(fd, buf, 0, buf.length, bytesRead);
    fs.closeSync(fd);
    bytesRead = stat.size;

    const chunk = buf.toString("utf-8");
    const newLines = chunk.split("\n").filter((l) => l.length > 0);
    for (const line of newLines) {
      onLog(jobId, line);
    }
  }, LOG_TAIL_INTERVAL_MS);
}

function stopLogTail(): void {
  if (logTailTimer) {
    clearInterval(logTailTimer);
    logTailTimer = null;
  }
}

/** Cancel the currently running job */
export function cancelRunningJob(jobId: string): boolean {
  if (activeJobId !== jobId || !activeWorker) return false;
  activeWorker.terminate();
  updateJob(jobId, { status: "cancelled", completedAt: new Date().toISOString() });
  stopLogTail();
  cleanupWorker();
  return true;
}

/** Stop the queue runner */
export function stopRunner(): void {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
  stopLogTail();
  if (activeWorker) {
    activeWorker.terminate();
    cleanupWorker();
  }
  log.info("Queue runner stopped");
}

/** Get the currently running job ID */
export function getActiveJobId(): string | null {
  return activeJobId;
}

function cleanupWorker(): void {
  activeWorker = null;
  activeJobId = null;
}
