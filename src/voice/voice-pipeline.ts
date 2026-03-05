// Voice pipeline orchestrator — script → TTS → alignment → words_timestamps.json
// Uses WhisperX for precise alignment when available, falls back to estimated timestamps.

import fs from "fs";
import path from "path";
import { execSync } from "child_process";
import { preprocessScript } from "./script-preprocessor.js";
import { textToSpeech } from "./elevenlabs-client.js";
import { alignAudio, ensureServiceRunning } from "./whisperx-client.js";
import { mergeTimestamps, saveTimestamps } from "./timestamp-merger.js";
import type { WordTimestamp } from "./types.js";

const DEFAULT_VOICE_ID = "21m00Tcm4TlvDq8ikWAM"; // ElevenLabs "Rachel" default

export interface VoicePipelineOptions {
  /** Path to script.txt with [SCENE:XX] markers */
  scriptPath: string;
  /** Output directory for audio + timestamps */
  outputDir: string;
  /** ElevenLabs voice ID (default: Rachel) */
  voiceId?: string;
  /** Language code for WhisperX alignment */
  language?: string;
}

export interface VoicePipelineResult {
  /** Path to generated audio WAV file */
  audioPath: string;
  /** Path to words_timestamps.json */
  timestampsPath: string;
  /** Total audio duration in seconds */
  totalDuration: number;
}

/** Get audio duration in seconds using ffprobe */
function getAudioDuration(audioPath: string): number {
  const result = execSync(
    `ffprobe -v error -show_entries format=duration -of csv=p=0 "${audioPath}"`,
    { encoding: "utf-8" }
  ).trim();
  return parseFloat(result);
}

/**
 * Generate estimated word-level timestamps by distributing words
 * evenly across the audio duration. Used as fallback when WhisperX unavailable.
 */
function estimateWordTimestamps(cleanText: string, totalDuration: number): WordTimestamp[] {
  const words = cleanText.split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];

  // Estimate each word's duration proportional to its character length
  const totalChars = words.reduce((sum, w) => sum + w.length, 0);
  let cursor = 0;

  return words.map((word) => {
    const wordDuration = (word.length / totalChars) * totalDuration;
    const start = cursor;
    const end = cursor + wordDuration;
    cursor = end;
    return { word, start: parseFloat(start.toFixed(3)), end: parseFloat(end.toFixed(3)) };
  });
}

/**
 * Try WhisperX alignment, fall back to estimated timestamps if unavailable.
 */
async function getWordTimestamps(
  audioPath: string,
  cleanText: string,
  language: string
): Promise<WordTimestamp[]> {
  try {
    await ensureServiceRunning();
    const timestamps = await alignAudio(audioPath, language);
    console.log(`[voice] WhisperX returned ${timestamps.length} word timestamp(s)`);
    return timestamps;
  } catch (err) {
    console.warn(`[voice] WhisperX unavailable, using estimated timestamps: ${(err as Error).message}`);
    const duration = getAudioDuration(audioPath);
    const estimated = estimateWordTimestamps(cleanText, duration);
    console.log(`[voice] Generated ${estimated.length} estimated word timestamp(s) over ${duration.toFixed(1)}s`);
    return estimated;
  }
}

/**
 * Run the full voice pipeline:
 * 1. Preprocess script (strip scene markers, record positions)
 * 2. Generate TTS audio via ElevenLabs
 * 3. Align audio (WhisperX or estimated fallback)
 * 4. Merge timestamps with scene markers
 * 5. Save words_timestamps.json
 */
export async function runVoicePipeline(
  opts: VoicePipelineOptions
): Promise<VoicePipelineResult> {
  const voiceId = opts.voiceId ?? DEFAULT_VOICE_ID;
  const language = opts.language ?? "en";

  // 1. Read and preprocess script
  const rawScript = fs.readFileSync(opts.scriptPath, "utf-8");
  const { cleanText, sceneMarkers } = preprocessScript(rawScript);
  console.log(`[voice] Preprocessed script: ${sceneMarkers.length} scene(s), ${cleanText.split(/\s+/).length} words`);

  // 2. Generate TTS audio
  const audioDir = path.join(opts.outputDir, "audio");
  fs.mkdirSync(audioDir, { recursive: true });
  const audioPath = path.join(audioDir, "voiceover.wav");
  console.log("[voice] Generating TTS audio via ElevenLabs...");
  await textToSpeech(cleanText, voiceId, audioPath);

  // 3. Get word timestamps (WhisperX or fallback)
  const wordTimestamps = await getWordTimestamps(audioPath, cleanText, language);

  // 4. Merge timestamps with scene markers
  const merged = mergeTimestamps(wordTimestamps, sceneMarkers);

  // 5. Save words_timestamps.json
  const timestampsPath = path.join(opts.outputDir, "words_timestamps.json");
  saveTimestamps(merged, timestampsPath);

  return {
    audioPath,
    timestampsPath,
    totalDuration: merged.total_duration,
  };
}
