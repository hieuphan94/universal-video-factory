// Structured logger — console output + optional file logging to pipeline.log

import * as fs from "fs";
import * as path from "path";

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface Logger {
  debug: (msg: string, ...args: unknown[]) => void;
  info: (msg: string, ...args: unknown[]) => void;
  warn: (msg: string, ...args: unknown[]) => void;
  error: (msg: string, ...args: unknown[]) => void;
}

// Global log file path — set once when output dir is known
let logFilePath: string | null = null;
let verbose = false;

/** Configure file logging target and verbosity level. */
export function configureLogger(outputDir: string, verboseMode = false): void {
  logFilePath = path.join(outputDir, "pipeline.log");
  verbose = verboseMode;
  fs.mkdirSync(outputDir, { recursive: true });
}

function writeToFile(line: string): void {
  if (!logFilePath) return;
  try {
    fs.appendFileSync(logFilePath, line + "\n", "utf-8");
  } catch {
    // Non-fatal — file logging is best-effort
  }
}

function log(phase: string, level: LogLevel, msg: string, args: unknown[]): void {
  const extra = args.length > 0 ? " " + args.map(String).join(" ") : "";
  const line = `[${phase.toUpperCase()}][${level.toUpperCase()}] ${msg}${extra}`;
  const timestamp = new Date().toISOString();
  const fileLine = `${timestamp} ${line}`;

  // Always write to file
  writeToFile(fileLine);

  // Console: skip debug unless verbose
  if (level === "debug" && !verbose) return;

  if (level === "error") {
    console.error(line);
  } else if (level === "warn") {
    console.warn(line);
  } else {
    console.log(line);
  }
}

/**
 * Create a logger scoped to a pipeline phase.
 * Usage: const logger = createLogger("capture");
 *        logger.info("Starting...");
 */
export function createLogger(phase: string): Logger {
  return {
    debug: (msg, ...args) => log(phase, "debug", msg, args),
    info:  (msg, ...args) => log(phase, "info",  msg, args),
    warn:  (msg, ...args) => log(phase, "warn",  msg, args),
    error: (msg, ...args) => log(phase, "error", msg, args),
  };
}
