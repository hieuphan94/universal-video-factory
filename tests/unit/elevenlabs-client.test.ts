// Unit tests for src/voice/elevenlabs-client.ts
// Tests fetchWithTimeout, getApiKey, and error handling paths via mocked fetch.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

describe("elevenlabs-client", () => {
  const originalEnv = process.env.ELEVENLABS_API_KEY;

  afterEach(() => {
    if (originalEnv !== undefined) {
      process.env.ELEVENLABS_API_KEY = originalEnv;
    } else {
      delete process.env.ELEVENLABS_API_KEY;
    }
    vi.restoreAllMocks();
  });

  describe("listVoices", () => {
    it("throws when ELEVENLABS_API_KEY is not set", async () => {
      delete process.env.ELEVENLABS_API_KEY;
      vi.resetModules();
      const { listVoices } = await import("../../src/voice/elevenlabs-client.js");

      await expect(listVoices()).rejects.toThrow("ELEVENLABS_API_KEY");
    });

    it("throws on non-200 response", async () => {
      process.env.ELEVENLABS_API_KEY = "test-key";
      vi.resetModules();

      const mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        text: () => Promise.resolve("Unauthorized"),
      });
      vi.stubGlobal("fetch", mockFetch);

      const { listVoices } = await import("../../src/voice/elevenlabs-client.js");
      await expect(listVoices()).rejects.toThrow("listVoices failed: 401");
    });

    it("returns voices on success", async () => {
      process.env.ELEVENLABS_API_KEY = "test-key";
      vi.resetModules();

      const mockVoices = [{ voice_id: "abc", name: "Rachel" }];
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ voices: mockVoices }),
      });
      vi.stubGlobal("fetch", mockFetch);

      const { listVoices } = await import("../../src/voice/elevenlabs-client.js");
      const voices = await listVoices();
      expect(voices).toEqual(mockVoices);
    });

    it("passes xi-api-key header", async () => {
      process.env.ELEVENLABS_API_KEY = "my-secret-key";
      vi.resetModules();

      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ voices: [] }),
      });
      vi.stubGlobal("fetch", mockFetch);

      const { listVoices } = await import("../../src/voice/elevenlabs-client.js");
      await listVoices();

      const callArgs = mockFetch.mock.calls[0];
      expect(callArgs[1].headers["xi-api-key"]).toBe("my-secret-key");
    });
  });

  describe("textToSpeechWithTimestamps", () => {
    it("throws on 422 with quota message", async () => {
      process.env.ELEVENLABS_API_KEY = "test-key";
      vi.resetModules();

      const mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 422,
        text: () => Promise.resolve("character_limit exceeded"),
      });
      vi.stubGlobal("fetch", mockFetch);

      const { textToSpeechWithTimestamps } = await import("../../src/voice/elevenlabs-client.js");
      await expect(
        textToSpeechWithTimestamps("hello", "voice-id", "/tmp/out.wav")
      ).rejects.toThrow("422");
    });

    it("retries on 429 rate limit", async () => {
      process.env.ELEVENLABS_API_KEY = "test-key";
      vi.resetModules();

      let callCount = 0;
      const mockFetch = vi.fn().mockImplementation(() => {
        callCount++;
        if (callCount <= 2) {
          return Promise.resolve({
            ok: false,
            status: 429,
            text: () => Promise.resolve("Rate limited"),
          });
        }
        return Promise.resolve({
          ok: false,
          status: 500,
          text: () => Promise.resolve("Server error"),
        });
      });
      vi.stubGlobal("fetch", mockFetch);

      const { textToSpeechWithTimestamps } = await import("../../src/voice/elevenlabs-client.js");
      await expect(
        textToSpeechWithTimestamps("hello", "voice-id", "/tmp/out.wav")
      ).rejects.toThrow();

      // Should have retried (maxAttempts=3)
      expect(callCount).toBe(3);
    });
  });
});
