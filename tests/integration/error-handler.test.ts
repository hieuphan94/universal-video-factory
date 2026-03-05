// Integration tests for src/orchestrator/error-handler.ts
// Tests error classification, user messaging, retry behavior

import { describe, it, expect, beforeEach } from "vitest";
import { classifyError, handleError } from "../../src/orchestrator/error-handler.js";
import type { ClassifiedError, ErrorCategory } from "../../src/orchestrator/error-handler.js";

describe("error-handler integration", () => {
  describe("classifyError — retryable errors", () => {
    it("classifies network errors as retryable", () => {
      const err = new Error("network error during request");
      const classified = classifyError(err);

      expect(classified.category).toBe("retryable");
      expect(classified.userMessage).toBe("A network or API error occurred.");
      expect(classified.suggestion).toBe(
        "The operation will be retried automatically."
      );
      expect(classified.originalError).toBe(err);
    });

    it("classifies timeout errors as retryable", () => {
      const err = new Error("request timeout after 30000ms");
      const classified = classifyError(err);
      expect(classified.category).toBe("retryable");
    });

    it("classifies ECONNRESET as retryable", () => {
      const err = new Error("ECONNRESET: connection reset by peer");
      const classified = classifyError(err);
      expect(classified.category).toBe("retryable");
    });

    it("classifies rate limit errors (429) as retryable", () => {
      const err = new Error("HTTP 429 rate limit exceeded");
      const classified = classifyError(err);
      expect(classified.category).toBe("retryable");
    });

    it("classifies 503 Service Unavailable as retryable", () => {
      const err = new Error("HTTP 503 Service Unavailable");
      const classified = classifyError(err);
      expect(classified.category).toBe("retryable");
    });

    it("classifies fetch failed error as retryable", () => {
      const err = new Error("Fetch failed: network unreachable");
      const classified = classifyError(err);
      expect(classified.category).toBe("retryable");
    });
  });

  describe("classifyError — fatal errors", () => {
    it("classifies missing API key as fatal", () => {
      const err = new Error(
        "ANTHROPIC_API_KEY is not set. Add it to .env.local"
      );
      const classified = classifyError(err);

      expect(classified.category).toBe("fatal");
      expect(classified.userMessage).toContain("ANTHROPIC_API_KEY");
      expect(classified.suggestion).toContain(".env");
    });

    it("classifies missing file (ENOENT) as fatal", () => {
      const err = new Error("ENOENT: no such file or directory");
      const classified = classifyError(err);

      expect(classified.category).toBe("fatal");
      expect(classified.userMessage).toBe("Required file not found.");
      expect(classified.suggestion).toContain("file path");
    });

    it("classifies missing FFmpeg as fatal", () => {
      const err = new Error("ffmpeg not found on this system");
      const classified = classifyError(err);

      expect(classified.category).toBe("fatal");
      expect(classified.userMessage).toBe("FFmpeg not found on this system.");
      expect(classified.suggestion).toContain("brew install");
    });

    it("classifies invalid config as fatal", () => {
      const err = new Error("invalid config: missing viewport dimensions");
      const classified = classifyError(err);

      expect(classified.category).toBe("fatal");
      expect(classified.suggestion).toContain("configuration");
    });

    it("classifies missing Python as fatal", () => {
      const err = new Error("python not found in PATH");
      const classified = classifyError(err);

      expect(classified.category).toBe("fatal");
      expect(classified.suggestion).toContain("Python");
    });

    it("classifies invalid URL as fatal", () => {
      const err = new Error("invalid url format");
      const classified = classifyError(err);

      expect(classified.category).toBe("fatal");
    });

    it("classifies credit balance errors as fatal", () => {
      const err = new Error(
        '400 {"type":"error","error":{"type":"invalid_request_error","message":"Your credit balance is too low to access the Anthropic API."}}'
      );
      const classified = classifyError(err);

      expect(classified.category).toBe("fatal");
      expect(classified.userMessage).toContain("credit balance");
      expect(classified.suggestion).toContain("console.anthropic.com");
    });
  });

  describe("classifyError — unknown errors", () => {
    it("classifies unknown errors as fatal by default", () => {
      const err = new Error("some weird thing happened");
      const classified = classifyError(err);

      expect(classified.category).toBe("fatal");
      expect(classified.userMessage).toContain("unexpected");
      expect(classified.suggestion).toContain("pipeline.log");
    });
  });

  describe("handleError — return value indicates retry eligibility", () => {
    it("returns true for retryable errors", () => {
      const err = new Error("network timeout");
      const isRetryable = handleError(err);
      expect(isRetryable).toBe(true);
    });

    it("returns false for fatal errors", () => {
      const err = new Error("ENOENT: file not found");
      const isRetryable = handleError(err);
      expect(isRetryable).toBe(false);
    });

    it("returns false for unknown errors", () => {
      const err = new Error("unexpected error");
      const isRetryable = handleError(err);
      expect(isRetryable).toBe(false);
    });
  });

  describe("error classification edge cases", () => {
    it("case-insensitive matching for network patterns", () => {
      const err = new Error("NETWORK error in uppercase");
      const classified = classifyError(err);
      expect(classified.category).toBe("retryable");
    });

    it("matches error patterns anywhere in message", () => {
      const err = new Error("The request encountered a timeout error");
      const classified = classifyError(err);
      expect(classified.category).toBe("retryable");
    });

    it("prefers retryable classification when multiple patterns match", () => {
      // This should match both retryable and be classified as retryable
      const err = new Error("network timeout");
      const classified = classifyError(err);
      expect(classified.category).toBe("retryable");
    });

    it("preserves original error in classified result", () => {
      const originalErr = new Error("original error message");
      const classified = classifyError(originalErr);
      expect(classified.originalError).toBe(originalErr);
      expect(classified.originalError.message).toBe("original error message");
    });
  });

  describe("error message specificity", () => {
    it("provides specific suggestion for ANTHROPIC_API_KEY", () => {
      const err = new Error("ANTHROPIC_API_KEY is not set");
      const classified = classifyError(err);
      expect(classified.suggestion).toContain("ANTHROPIC_API_KEY");
    });

    it("provides specific suggestion for ELEVENLABS_API_KEY", () => {
      const err = new Error("ELEVENLABS_API_KEY is not set");
      const classified = classifyError(err);
      expect(classified.suggestion).toContain("ELEVENLABS_API_KEY");
    });

    it("provides generic fallback suggestion for unknown errors", () => {
      const err = new Error("something broke");
      const classified = classifyError(err);
      expect(classified.suggestion).toBeTruthy();
      expect(classified.suggestion.length).toBeGreaterThan(0);
    });
  });

  describe("multiple error pattern combinations", () => {
    it("handles errors with multiple matching patterns", () => {
      // Message contains both "network" and "timeout"
      const err = new Error("network timeout occurred");
      const classified = classifyError(err);
      expect(classified.category).toBe("retryable");
    });

    it("distinguishes between similar but different patterns", () => {
      // "not found" alone vs "not set"
      const err1 = classifyError(new Error("file not found"));
      const err2 = classifyError(
        new Error("ANTHROPIC_API_KEY is not set")
      );

      expect(err1.category).toBe("fatal");
      expect(err2.category).toBe("fatal");
      expect(err1.userMessage).not.toBe(err2.userMessage);
    });
  });
});
