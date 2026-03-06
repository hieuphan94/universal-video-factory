// Shared types for the compositor module

export interface SceneTiming {
  id: string;          // e.g. "scene-01"
  videoPath: string;   // absolute path to scene-XX.mp4
  startFrame: number;  // frame number in final composition
  durationFrames: number;
}

export interface WordFrame {
  word: string;
  startFrame: number;
  endFrame: number;
}

/** Full props passed to Remotion renderMedia as inputProps */
export interface RenderInputProps {
  scenes: SceneTiming[];
  audioPath: string;
  words: WordFrame[];
  fps: number;
  width: number;
  height: number;
  totalDurationFrames: number;
}

export interface RenderOptions {
  projectDir: string;   // project output directory
  outputPath: string;   // destination MP4 path
  codec?: "h264" | "h265" | "vp8" | "vp9";
  concurrency?: number; // parallel render threads
  onProgress?: (progress: number) => void;
}

export interface RenderResult {
  outputPath: string;
  durationMs: number;
  framesRendered: number;
}
