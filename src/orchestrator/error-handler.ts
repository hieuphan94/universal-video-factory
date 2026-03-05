// Centralized error handler — classify errors, user-friendly messages, no raw stack traces

import { createLogger } from "../utils/logger.js";

const logger = createLogger("error-handler");

export type ErrorCategory = "retryable" | "fatal" | "warning";

export interface ClassifiedError {
  category: ErrorCategory;
  userMessage: string;
  suggestion: string;
  originalError: Error;
}

/** Patterns that indicate transient/retryable failures */
const RETRYABLE_PATTERNS = [
  /network/i,
  /timeout/i,
  /ECONNRESET/,
  /ECONNREFUSED/,
  /ETIMEDOUT/,
  /rate.?limit/i,
  /429/,
  /503/,
  /502/,
  /fetch failed/i,
];

/** Patterns that indicate fatal config/dependency errors */
const FATAL_PATTERNS = [
  /API_KEY.*not set/i,
  /credit balance/i,
  /billing/i,
  /not found/i,
  /ENOENT/,
  /invalid.*config/i,
  /ffmpeg.*not found/i,
  /python.*not found/i,
  /invalid url/i,
];

/**
 * Classify an error into retryable vs fatal category.
 * Retryable = transient API/network failures.
 * Fatal = bad config, missing files, missing dependencies.
 */
export function classifyError(err: Error): ClassifiedError {
  const msg = err.message;

  if (RETRYABLE_PATTERNS.some((p) => p.test(msg))) {
    return {
      category: "retryable",
      userMessage: "A network or API error occurred.",
      suggestion: "The operation will be retried automatically.",
      originalError: err,
    };
  }

  if (FATAL_PATTERNS.some((p) => p.test(msg))) {
    return {
      category: "fatal",
      userMessage: buildFatalMessage(msg),
      suggestion: buildSuggestion(msg),
      originalError: err,
    };
  }

  // Unknown — treat as fatal by default
  return {
    category: "fatal",
    userMessage: `An unexpected error occurred: ${msg}`,
    suggestion: "Check pipeline.log for details.",
    originalError: err,
  };
}

/**
 * Handle a classified error — log details to file, print clean message to console.
 * Returns true if the error is retryable (caller may retry), false if fatal.
 */
export function handleError(err: Error): boolean {
  const classified = classifyError(err);

  // Always log full stack to file
  logger.error(`${classified.userMessage} | ${err.stack ?? err.message}`);

  if (classified.category === "fatal") {
    console.error(`\n[error] ${classified.userMessage}`);
    if (classified.suggestion) {
      console.error(`[hint]  ${classified.suggestion}`);
    }
    return false;
  }

  return true;
}

function buildFatalMessage(msg: string): string {
  if (/credit balance/i.test(msg) || /billing/i.test(msg)) {
    return "Anthropic API credit balance is too low.";
  }
  if (/API_KEY/i.test(msg)) {
    const key = msg.match(/(\w+_API_KEY)/)?.[1] ?? "API_KEY";
    return `Missing environment variable: ${key}`;
  }
  if (/ENOENT/.test(msg)) {
    return "Required file not found.";
  }
  if (/ffmpeg/i.test(msg)) {
    return "FFmpeg not found on this system.";
  }
  return `Configuration error: ${msg}`;
}

function buildSuggestion(msg: string): string {
  if (/credit balance/i.test(msg) || /billing/i.test(msg))
    return "Top up credits at https://console.anthropic.com/settings/billing";
  if (/ANTHROPIC_API_KEY/i.test(msg)) return "Add ANTHROPIC_API_KEY to .env.local";
  if (/ELEVENLABS_API_KEY/i.test(msg)) return "Add ELEVENLABS_API_KEY to .env.local";
  if (/ffmpeg/i.test(msg)) return "Install FFmpeg: brew install ffmpeg";
  if (/python/i.test(msg)) return "Install Python 3.10+: brew install python@3.10";
  if (/ENOENT/.test(msg)) return "Verify the file path exists and is readable.";
  return "Check the configuration and try again.";
}
