// ElevenLabs API client — list voices, clone voice, text-to-speech.
// Loads ELEVENLABS_API_KEY from .env.local via dotenv.

import fs from "fs";
import path from "path";
import { createRequire } from "module";
import { type ElevenLabsVoice, type TTSOptions, type VoiceSettings } from "./types.js";
import { withRetry } from "../utils/retry.js";

// Load .env.local
const require = createRequire(import.meta.url);
const dotenv = require("dotenv");
dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });

const BASE_URL = "https://api.elevenlabs.io";
const DEFAULT_MODEL = "eleven_multilingual_v2";
const DEFAULT_VOICE_SETTINGS: VoiceSettings = {
  stability: 0.5,
  similarity_boost: 0.75,
};

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
  const res = await fetch(`${BASE_URL}/v1/voices`, {
    headers: headers({ Accept: "application/json" }),
  });
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

  const res = await fetch(`${BASE_URL}/v1/voices/add`, {
    method: "POST",
    headers: headers(),
    body: form,
  });

  if (!res.ok) {
    throw new Error(`cloneVoice failed: ${res.status} ${await res.text()}`);
  }
  const data = (await res.json()) as { voice_id: string };
  return data.voice_id;
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
  const modelId = options.modelId ?? DEFAULT_MODEL;
  const voiceSettings = options.voiceSettings ?? DEFAULT_VOICE_SETTINGS;

  const body = {
    text,
    model_id: modelId,
    voice_settings: voiceSettings,
  };

  return withRetry(
    async () => {
      const res = await fetch(`${BASE_URL}/v1/text-to-speech/${voiceId}`, {
        method: "POST",
        headers: headers({
          "Content-Type": "application/json",
          Accept: "audio/wav",
        }),
        body: JSON.stringify(body),
      });

      if (res.status === 429) {
        throw new Error(`Rate limited (429) — will retry`);
      }

      if (res.status === 422) {
        const detail = await res.text();
        if (detail.includes("quota") || detail.includes("character_limit")) {
          console.error("[elevenlabs] Character quota exceeded. Upgrade plan or reduce text length.");
        }
        // 422 is not retryable — throw without retry by re-throwing after max attempts
        throw new Error(`textToSpeech failed (422): ${detail}`);
      }

      if (!res.ok) {
        throw new Error(`textToSpeech failed: ${res.status} ${await res.text()}`);
      }

      const buffer = await res.arrayBuffer();
      fs.mkdirSync(path.dirname(outputPath), { recursive: true });
      fs.writeFileSync(outputPath, Buffer.from(buffer));
      console.log(`[elevenlabs] Saved audio → ${outputPath}`);
      return outputPath;
    },
    { maxAttempts: 3, initialDelayMs: 1000 }
  );
}
