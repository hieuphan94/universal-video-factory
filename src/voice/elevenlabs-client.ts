// ElevenLabs API client — list voices, clone voice, text-to-speech.
// Expects ELEVENLABS_API_KEY to be loaded by CLI entry point.

import fs from "fs";
import path from "path";
import { type ElevenLabsVoice, type TTSOptions, type VoiceSettings } from "./types.js";
import { withRetry } from "../utils/retry.js";
import { createLogger } from "../utils/logger.js";

const log = createLogger("elevenlabs");

const BASE_URL = "https://api.elevenlabs.io";
const DEFAULT_MODEL = "eleven_multilingual_v2";
const DEFAULT_VOICE_SETTINGS: VoiceSettings = {
  stability: 0.5,
  similarity_boost: 0.75,
};

/** Fetch with AbortController timeout to prevent hung requests */
function fetchWithTimeout(url: string, init: RequestInit, timeoutMs = 30_000): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, { ...init, signal: controller.signal }).finally(() => clearTimeout(timer));
}

function getApiKey(): string {
  const key = process.env.ELEVENLABS_API_KEY;
  if (!key) {
    throw new Error("ELEVENLABS_API_KEY is not set. Add it to .env.local");
  }
  return key;
}

function headers(extra: Record<string, string> = {}): Record<string, string> {
  return {
    "xi-api-key": getApiKey(),
    ...extra,
  };
}

/** Fetch all available voices from the ElevenLabs account. */
export async function listVoices(): Promise<ElevenLabsVoice[]> {
  const res = await fetchWithTimeout(`${BASE_URL}/v1/voices`, {
    headers: headers({ Accept: "application/json" }),
  }, 15_000);
  if (!res.ok) {
    throw new Error(`listVoices failed: ${res.status} ${await res.text()}`);
  }
  const data = (await res.json()) as { voices: ElevenLabsVoice[] };
  return data.voices;
}

/**
 * Clone a voice from a reference audio file.
 * Returns the new voice_id.
 */
export async function cloneVoice(name: string, referenceAudioPath: string): Promise<string> {
  const form = new FormData();
  form.append("name", name);

  const audioBuffer = fs.readFileSync(referenceAudioPath);
  const blob = new Blob([audioBuffer], { type: "audio/wav" });
  form.append("files", blob, path.basename(referenceAudioPath));

  const res = await fetchWithTimeout(`${BASE_URL}/v1/voices/add`, {
    method: "POST",
    headers: headers(),
    body: form,
  }, 60_000);

  if (!res.ok) {
    throw new Error(`cloneVoice failed: ${res.status} ${await res.text()}`);
  }
  const data = (await res.json()) as { voice_id: string };
  return data.voice_id;
}

/** Character-level alignment from ElevenLabs with-timestamps endpoint */
export interface ElevenLabsAlignment {
  characters: string[];
  character_start_times_seconds: number[];
  character_end_times_seconds: number[];
}

/** Result from textToSpeechWithTimestamps */
export interface TTSWithTimestampsResult {
  outputPath: string;
  alignment: ElevenLabsAlignment;
}

/**
 * Convert text to speech and save the audio to outputPath.
 * Returns the output file path.
 */
export async function textToSpeech(
  text: string,
  voiceId: string,
  outputPath: string,
  options: TTSOptions = {}
): Promise<string> {
  const result = await textToSpeechWithTimestamps(text, voiceId, outputPath, options);
  return result.outputPath;
}

/**
 * Convert text to speech with character-level timestamps.
 * Uses the /with-timestamps endpoint to get alignment data directly from ElevenLabs.
 * Returns both the audio file path and character-level timing.
 */
export async function textToSpeechWithTimestamps(
  text: string,
  voiceId: string,
  outputPath: string,
  options: TTSOptions = {}
): Promise<TTSWithTimestampsResult> {
  const modelId = options.modelId ?? DEFAULT_MODEL;
  const voiceSettings = options.voiceSettings ?? DEFAULT_VOICE_SETTINGS;

  const body = {
    text,
    model_id: modelId,
    voice_settings: voiceSettings,
    output_format: "mp3_44100_128",
  };

  // Use .mp3 extension since with-timestamps returns base64-encoded audio
  const mp3Path = outputPath.replace(/\.wav$/, ".mp3");

  return withRetry(
    async () => {
      const res = await fetchWithTimeout(`${BASE_URL}/v1/text-to-speech/${voiceId}/with-timestamps`, {
        method: "POST",
        headers: headers({
          "Content-Type": "application/json",
        }),
        body: JSON.stringify(body),
      }, 60_000);

      if (res.status === 429) {
        throw new Error(`Rate limited (429) — will retry`);
      }

      if (res.status === 422) {
        const detail = await res.text();
        if (detail.includes("quota") || detail.includes("character_limit")) {
          log.error("Character quota exceeded. Upgrade plan or reduce text length.");
        }
        throw new Error(`textToSpeech failed (422): ${detail}`);
      }

      if (!res.ok) {
        throw new Error(`textToSpeech failed: ${res.status} ${await res.text()}`);
      }

      const data = await res.json() as {
        audio_base64: string;
        alignment: ElevenLabsAlignment;
        normalized_alignment: ElevenLabsAlignment;
      };

      // Decode base64 audio and write MP3 file
      const audioBuffer = Buffer.from(data.audio_base64, "base64");
      fs.mkdirSync(path.dirname(mp3Path), { recursive: true });
      fs.writeFileSync(mp3Path, audioBuffer);
      log.info(`Saved audio → ${mp3Path}`);

      // Prefer normalized_alignment (post text-normalization) for accuracy
      const alignment = data.normalized_alignment ?? data.alignment;

      return { outputPath: mp3Path, alignment };
    },
    { maxAttempts: 3, initialDelayMs: 1000 }
  );
}
