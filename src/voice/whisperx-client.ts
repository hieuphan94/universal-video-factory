// TypeScript HTTP client for the WhisperX FastAPI service.
// Auto-starts the Python service if not already running, waits for health check.

import fs from "fs";
import path from "path";
import { spawn } from "child_process";
import { type WhisperXAlignResponse, type WordTimestamp } from "./types.js";

const SERVICE_URL = "http://127.0.0.1:8765";
const HEALTH_URL = `${SERVICE_URL}/health`;
const ALIGN_URL = `${SERVICE_URL}/align`;
const START_TIMEOUT_MS = 15_000;
const HEALTH_POLL_MS = 2_000;

const SERVICE_DIR = path.resolve(
  new URL(".", import.meta.url).pathname,
  "../../services/whisperx-service"
);

/** Check if the WhisperX service is reachable. */
async function isServiceHealthy(): Promise<boolean> {
  try {
    const res = await fetch(HEALTH_URL, { signal: AbortSignal.timeout(3000) });
    return res.ok;
  } catch {
    return false;
  }
}

/** Spawn the WhisperX service via start.sh and wait until healthy. */
async function startService(): Promise<void> {
  const startScript = path.join(SERVICE_DIR, "start.sh");
  if (!fs.existsSync(startScript)) {
    throw new Error(`WhisperX start.sh not found at: ${startScript}`);
  }

  console.log("[whisperx] Starting WhisperX service...");
  const child = spawn("bash", [startScript], {
    detached: true,
    stdio: "ignore",
    cwd: SERVICE_DIR,
  });
  child.unref();

  const deadline = Date.now() + START_TIMEOUT_MS;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, HEALTH_POLL_MS));
    if (await isServiceHealthy()) {
      console.log("[whisperx] Service is ready.");
      return;
    }
  }

  throw new Error(`WhisperX service did not become healthy within ${START_TIMEOUT_MS / 1000}s`);
}

/** Ensure the service is running, starting it if necessary. */
export async function ensureServiceRunning(): Promise<void> {
  if (await isServiceHealthy()) {
    return;
  }
  await startService();
}

/**
 * Submit an audio file to the WhisperX service for word-level alignment.
 * Returns an array of word timestamps.
 */
export async function alignAudio(
  audioPath: string,
  language = "en"
): Promise<WordTimestamp[]> {
  await ensureServiceRunning();

  if (!fs.existsSync(audioPath)) {
    throw new Error(`Audio file not found: ${audioPath}`);
  }

  const audioBuffer = fs.readFileSync(audioPath);
  const blob = new Blob([audioBuffer], { type: "audio/wav" });

  const form = new FormData();
  form.append("audio", blob, path.basename(audioPath));
  form.append("language", language);

  const res = await fetch(ALIGN_URL, {
    method: "POST",
    body: form,
    signal: AbortSignal.timeout(START_TIMEOUT_MS),
  });

  if (!res.ok) {
    const detail = await res.text();
    throw new Error(`WhisperX align failed: ${res.status} ${detail}`);
  }

  const data = (await res.json()) as WhisperXAlignResponse;
  return data.words;
}
