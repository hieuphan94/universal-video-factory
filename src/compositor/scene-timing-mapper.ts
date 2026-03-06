import * as fs from "fs";
import * as path from "path";
import type { SceneTiming, WordFrame, ClickEvent, RenderInputProps } from "./types.js";

// Shape of words_timestamps.json
interface WordsTimestampsFile {
  words: { word: string; start: number; end: number }[];
}

// Shape of capture_metadata.json
interface CaptureMetadata {
  scenes: {
    id: string;
    videoFile: string;
    start: number;
    end: number;
    actionDescription?: string;
    clickX?: number;
    clickY?: number;
  }[];
  audioFile: string;
  totalDuration: number;
}

const FPS = 30;

function secondsToFrames(seconds: number): number {
  return Math.round(seconds * FPS);
}

/**
 * Maps scene video files and word timestamps from project JSON files
 * into Remotion-compatible frame-based InputProps.
 *
 * Reads:
 *   - {projectDir}/words_timestamps.json
 *   - {projectDir}/capture_metadata.json
 */
export function mapProjectToRenderProps(projectDir: string): RenderInputProps {
  const timestampsPath = path.join(projectDir, "words_timestamps.json");
  const metadataPath = path.join(projectDir, "capture_metadata.json");

  if (!fs.existsSync(timestampsPath)) {
    throw new Error(`words_timestamps.json not found in: ${projectDir}`);
  }
  if (!fs.existsSync(metadataPath)) {
    throw new Error(`capture_metadata.json not found in: ${projectDir}`);
  }

  const timestamps: WordsTimestampsFile = JSON.parse(
    fs.readFileSync(timestampsPath, "utf-8")
  );
  const metadata: CaptureMetadata = JSON.parse(
    fs.readFileSync(metadataPath, "utf-8")
  );

  // Paths are relative to projectDir which is set as Remotion's publicDir.
  // Remotion serves them via http://localhost:PORT/<relative-path>
  const scenes: SceneTiming[] = metadata.scenes.map((s) => ({
    id: s.id,
    videoPath: `/${s.videoFile}`,
    startFrame: secondsToFrames(s.start),
    durationFrames: Math.max(1, secondsToFrames(s.end - s.start)),
  }));

  const words: WordFrame[] = (timestamps.words ?? []).map((w) => ({
    word: w.word,
    startFrame: secondsToFrames(w.start),
    endFrame: secondsToFrames(w.end),
  }));

  const totalDurationFrames = secondsToFrames(metadata.totalDuration);
  const audioPath = `/${metadata.audioFile}`;

  // Generate click events from scene metadata (one click per scene with valid coordinates).
  // Each click appears 15 frames into the scene so the viewer sees the action context first.
  const clicks: ClickEvent[] = metadata.scenes
    .filter((s) => s.clickX != null && s.clickY != null && s.clickX > 0 && s.clickY > 0)
    .map((s) => ({
      x: s.clickX!,
      y: s.clickY!,
      frame: secondsToFrames(s.start) + 15,
      duration: 30,
    }));

  return {
    scenes,
    audioPath,
    words,
    fps: FPS,
    width: 1920,
    height: 1080,
    totalDurationFrames,
    clicks,
  };
}
