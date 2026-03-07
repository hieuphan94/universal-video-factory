// Voice pipeline orchestrator — script → TTS → alignment → words_timestamps.json
// Uses ElevenLabs with-timestamps for character-level alignment.

import fs from "fs";
import path from "path";
import { preprocessScript } from "./script-preprocessor.js";
import { textToSpeechWithTimestamps } from "./elevenlabs-client.js";
import type { ElevenLabsAlignment } from "./elevenlabs-client.js";
import { mergeTimestamps, saveTimestamps } from "./timestamp-merger.js";
import type { WordTimestamp } from "./types.js";
import { createLogger } from "../utils/logger.js";

const log = createLogger("voice");

const DEFAULT_VOICE_ID = "21m00Tcm4TlvDq8ikWAM"; // ElevenLabs "Rachel" default

export interface VoicePipelineOptions {
  /** Path to script.txt with [SCENE:XX] markers */
  scriptPath: string;
  /** Output directory for audio + timestamps */
  outputDir: string;
  /** ElevenLabs voice ID (default: Rachel) */
  voiceId?: string;
  /** Language code for TTS */
  language?: string;
}

export interface SceneDuration {
  id: string;
  /** Duration of this scene's narration in seconds */
  durationSec: number;
  /** Start time of this scene's narration in seconds */
  startSec: number;
}

export interface VoicePipelineResult {
  /** Path to generated audio WAV file */
  audioPath: string;
  /** Path to words_timestamps.json */
  timestampsPath: string;
  /** Total audio duration in seconds */
  totalDuration: number;
  /** Per-scene narration durations for driving video capture timing */
  sceneDurations: SceneDuration[];
}

/**
 * Convert ElevenLabs character-level alignment to word-level timestamps.
 * Groups consecutive non-space characters into words, using the first
 * character's start and last character's end as word boundaries.
 */
function alignmentToWordTimestamps(alignment: ElevenLabsAlignment): WordTimestamp[] {
  const { characters, character_start_times_seconds, character_end_times_seconds } = alignment;
  const words: WordTimestamp[] = [];
  let currentWord = "";
  let wordStart = -1;
  let wordEnd = 0;

  for (let i = 0; i < characters.length; i++) {
    const ch = characters[i];
    if (ch === " " || ch === "\n" || ch === "\t") {
      // Whitespace: flush current word
      if (currentWord.length > 0) {
        words.push({ word: currentWord, start: wordStart, end: wordEnd });
        currentWord = "";
        wordStart = -1;
      }
    } else {
      if (wordStart < 0) wordStart = character_start_times_seconds[i];
      wordEnd = character_end_times_seconds[i];
      currentWord += ch;
    }
  }
  // Flush last word
  if (currentWord.length > 0) {
    words.push({ word: currentWord, start: wordStart, end: wordEnd });
  }

  log.info(`ElevenLabs alignment: ${words.length} word timestamp(s)`);
  return words;
}

/**
 * Run the full voice pipeline:
 * 1. Preprocess script (strip scene markers, record positions)
 * 2. Generate TTS audio via ElevenLabs
 * 3. Convert character-level alignment to word timestamps
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
  log.info(`Preprocessed script: ${sceneMarkers.length} scene(s), ${cleanText.split(/\s+/).length} words`);

  // 2. Generate TTS audio with character-level alignment from ElevenLabs
  const audioDir = path.join(opts.outputDir, "audio");
  fs.mkdirSync(audioDir, { recursive: true });
  const audioPathHint = path.join(audioDir, "voiceover.wav");
  log.info("Generating TTS audio with timestamps via ElevenLabs...");
  const ttsResult = await textToSpeechWithTimestamps(cleanText, voiceId, audioPathHint);
  const audioPath = ttsResult.outputPath; // actual path (may be .mp3)

  // 3. Convert character-level alignment to word-level timestamps
  const wordTimestamps = alignmentToWordTimestamps(ttsResult.alignment);

  // 4. Merge timestamps with scene markers
  const merged = mergeTimestamps(wordTimestamps, sceneMarkers);

  // 5. Save words_timestamps.json
  const timestampsPath = path.join(opts.outputDir, "words_timestamps.json");
  saveTimestamps(merged, timestampsPath);

  // Compute per-scene durations for voice-driven capture timing
  const sceneDurations: SceneDuration[] = merged.scenes.map((s) => ({
    id: s.id,
    durationSec: s.end_time - s.start_time,
    startSec: s.start_time,
  }));

  return {
    audioPath,
    timestampsPath,
    totalDuration: merged.total_duration,
    sceneDurations,
  };
}
