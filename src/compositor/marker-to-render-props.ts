// Converts markers.json (ms-based) → Remotion-compatible render props (frame-based)
// Used by the human-assisted pipeline as an alternative to capture_metadata-based mapping

import * as fs from "fs";
import * as path from "path";
import type { MarkersFile } from "../detection/detection-types.js";
import { MarkersFileSchema } from "../detection/detection-types.js";
import type { SceneTiming, WordFrame, ClickEvent, RenderInputProps } from "./types.js";
import { DEFAULT_INTRO_FRAMES, DEFAULT_OUTRO_FRAMES } from "./types.js";

const FPS = 30;

function msToFrames(ms: number): number {
  return Math.round((ms / 1000) * FPS);
}

export interface MarkerZoomEvent {
  frame: number;
  x: number;
  y: number;
  scale: number;
  duration: number;
}

export interface MarkerHighlightEvent {
  startFrame: number;
  durationFrames: number;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface MarkerCursorPoint {
  frame: number;
  x: number;
  y: number;
}

export interface MarkerRenderProps extends RenderInputProps {
  zoomEvents: MarkerZoomEvent[];
  highlights: MarkerHighlightEvent[];
  cursorTrail: MarkerCursorPoint[];
}

/** Load markers.json and convert to frame-based render props */
export function mapMarkersToRenderProps(
  markersPath: string,
  videoPath: string,
  audioPath: string,
  wordsPath?: string
): MarkerRenderProps {
  const markersRaw = JSON.parse(fs.readFileSync(markersPath, "utf-8"));
  const markers: MarkersFile = MarkersFileSchema.parse(markersRaw);

  // Scenes → frame-based, offset by intro
  const scenes: SceneTiming[] = markers.scenes.map((s) => ({
    id: `scene-${String(s.id).padStart(2, "0")}`,
    videoPath,
    startFrame: msToFrames(s.startMs),
    durationFrames: Math.max(1, msToFrames(s.endMs - s.startMs)),
  }));

  // Click markers → ClickEvent props
  // No intro offset — these render inside <Sequence from={introDuration}>,
  // so useCurrentFrame() is already relative to content start
  const clicks: ClickEvent[] = markers.markers
    .filter((m) => m.type === "click")
    .map((m) => ({
      x: m.x,
      y: m.y,
      frame: msToFrames(m.ms),
      duration: 30,
    }));

  // Zoom markers → ZoomEvent props (no intro offset — inside content Sequence)
  const zoomEvents: MarkerZoomEvent[] = markers.markers
    .filter((m) => m.type === "zoom")
    .map((m) => ({
      frame: msToFrames(m.startMs),
      x: m.x,
      y: m.y,
      scale: m.scale,
      duration: Math.max(1, msToFrames(m.endMs - m.startMs)),
    }));

  // Highlight markers → frame-based (no intro offset — inside content Sequence)
  const highlights: MarkerHighlightEvent[] = markers.markers
    .filter((m) => m.type === "highlight")
    .map((m) => ({
      startFrame: msToFrames(m.startMs),
      durationFrames: Math.max(1, msToFrames(m.endMs - m.startMs)),
      x: m.x,
      y: m.y,
      w: m.w,
      h: m.h,
    }));

  // Words timestamps (optional — may not exist yet if voice not generated)
  let words: WordFrame[] = [];
  if (wordsPath && fs.existsSync(wordsPath)) {
    const wordsRaw = JSON.parse(fs.readFileSync(wordsPath, "utf-8"));
    words = (wordsRaw.words ?? []).map((w: { word: string; start: number; end: number }) => ({
      word: w.word,
      startFrame: Math.round(w.start * FPS) + DEFAULT_INTRO_FRAMES,
      endFrame: Math.round(w.end * FPS) + DEFAULT_INTRO_FRAMES,
    }));
  }

  // Cursor trail → frame-based
  const cursorTrail: MarkerCursorPoint[] = (markers.cursorTrail ?? []).map((c) => ({
    frame: msToFrames(c.ms),
    x: c.x,
    y: c.y,
  }));

  // Total duration = last scene end + outro
  const lastScene = markers.scenes[markers.scenes.length - 1];
  const contentFrames = lastScene ? msToFrames(lastScene.endMs) : 0;
  const totalDurationFrames = DEFAULT_INTRO_FRAMES + contentFrames + DEFAULT_OUTRO_FRAMES;

  return {
    scenes,
    audioPath,
    words,
    fps: FPS,
    width: 1920,
    height: 1080,
    totalDurationFrames,
    clicks,
    zoomEvents,
    highlights,
    cursorTrail,
  };
}
