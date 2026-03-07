// Converts markers.json (ms-based) → Remotion-compatible render props (frame-based)
// Used by the human-assisted pipeline as an alternative to capture_metadata-based mapping

import * as fs from "fs";
import * as path from "path";
import type { MarkersFile } from "../detection/detection-types.js";
import { MarkersFileSchema } from "../detection/detection-types.js";
import type { SceneTiming, WordFrame, ClickEvent, RenderInputProps } from "./types.js";
import { DEFAULT_INTRO_FRAMES, DEFAULT_OUTRO_FRAMES } from "./types.js";
import type { SceneAudioFile } from "../voice/types.js";

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
  wordsPath?: string,
  sceneAudioFiles?: SceneAudioFile[]
): MarkerRenderProps {
  const markersRaw = JSON.parse(fs.readFileSync(markersPath, "utf-8"));
  const markers: MarkersFile = MarkersFileSchema.parse(markersRaw);

  // Build scene-audio lookup by scene number (e.g. "SCENE:01" → audioPath + duration)
  const sceneAudioMap = new Map<string, { path: string; durationFrames: number }>();
  if (sceneAudioFiles) {
    for (const sa of sceneAudioFiles) {
      const num = sa.sceneId.replace("SCENE:", "");
      sceneAudioMap.set(num, {
        path: sa.audioPath,
        durationFrames: Math.ceil(sa.durationSec * FPS),
      });
    }
  }

  // Scenes → frame-based, offset by intro
  // Scene duration = max(video recording duration, audio narration duration)
  // so voice is never cut short even if user advanced quickly.
  // startFrame is recalculated when scenes extend to avoid overlap.
  const scenes: SceneTiming[] = [];
  let currentFrame = 0;
  for (const s of markers.scenes) {
    const sceneNum = String(s.id).padStart(2, "0");
    const audio = sceneAudioMap.get(sceneNum);
    const videoDurationFrames = Math.max(1, msToFrames(s.endMs - s.startMs));
    const audioDurationFrames = audio?.durationFrames ?? 0;
    const effectiveDuration = Math.max(videoDurationFrames, audioDurationFrames);
    scenes.push({
      id: `scene-${sceneNum}`,
      videoPath,
      startFrame: currentFrame,
      durationFrames: effectiveDuration,
      audioPath: audio?.path,
    });
    currentFrame += effectiveDuration;
  }

  // Remap frame from original recording timeline to adjusted timeline
  // (accounts for scenes extended to fit longer voice narration)
  function remapFrame(originalFrame: number): number {
    for (let i = 0; i < markers.scenes.length; i++) {
      const ms = markers.scenes[i];
      const scene = scenes[i];
      if (!ms || !scene) break;
      const origStart = msToFrames(ms.startMs);
      const origEnd = msToFrames(ms.endMs);
      if (originalFrame >= origStart && originalFrame < origEnd) {
        return scene.startFrame + (originalFrame - origStart);
      }
    }
    return originalFrame;
  }

  // Click markers → ClickEvent props (remapped to adjusted timeline)
  const clicks: ClickEvent[] = markers.markers
    .filter((m) => m.type === "click")
    .map((m) => ({
      x: m.x,
      y: m.y,
      frame: remapFrame(msToFrames(m.ms)),
      duration: 30,
    }));

  // Zoom markers → ZoomEvent props (remapped to adjusted timeline)
  const zoomEvents: MarkerZoomEvent[] = markers.markers
    .filter((m) => m.type === "zoom")
    .map((m) => ({
      frame: remapFrame(msToFrames(m.startMs)),
      x: m.x,
      y: m.y,
      scale: m.scale,
      duration: Math.max(1, msToFrames(m.endMs - m.startMs)),
    }));

  // Highlight markers → frame-based (remapped to adjusted timeline)
  const highlights: MarkerHighlightEvent[] = markers.markers
    .filter((m) => m.type === "highlight")
    .map((m) => ({
      startFrame: remapFrame(msToFrames(m.startMs)),
      durationFrames: Math.max(1, msToFrames(m.endMs - m.startMs)),
      x: m.x,
      y: m.y,
      w: m.w,
      h: m.h,
    }));

  // Words timestamps (optional — may not exist yet if voice not generated)
  // When per-scene audio is used, word frames are offset to each scene's start
  // so karaoke subtitles align with the scene's audio, not the original single track
  let words: WordFrame[] = [];
  if (wordsPath && fs.existsSync(wordsPath)) {
    const wordsRaw = JSON.parse(fs.readFileSync(wordsPath, "utf-8"));
    const hasPerSceneAudio = sceneAudioFiles && sceneAudioFiles.length > 0;

    if (hasPerSceneAudio && wordsRaw.scenes) {
      // Per-scene mode: offset each word relative to its scene's video start frame
      const sceneBoundaries: Array<{ start_time: number; end_time: number }> = wordsRaw.scenes;
      const allWords: Array<{ word: string; start: number; end: number }> = wordsRaw.words ?? [];

      // Only map words for scenes that exist in both audio and video
      const mappableScenes = Math.min(sceneBoundaries.length, scenes.length);
      for (let si = 0; si < mappableScenes; si++) {
        const sb = sceneBoundaries[si];
        const scene = scenes[si];
        if (!scene || !sb) continue;

        // Find words belonging to this scene (by start time in original audio)
        // Use next scene boundary to avoid bleeding words across scenes
        const nextSb = sceneBoundaries[si + 1];
        const sceneEndTime = nextSb ? nextSb.start_time : sb.end_time + 0.01;
        const sceneWords = allWords.filter(
          (w) => w.start >= sb.start_time - 0.001 && w.start < sceneEndTime
        );

        // Offset: word time relative to scene audio start → absolute frame in composition
        const sceneStartFrame = DEFAULT_INTRO_FRAMES + scene.startFrame;
        for (const w of sceneWords) {
          const relativeStart = w.start - sb.start_time;
          const relativeEnd = w.end - sb.start_time;
          words.push({
            word: w.word,
            startFrame: Math.round(relativeStart * FPS) + sceneStartFrame,
            endFrame: Math.round(relativeEnd * FPS) + sceneStartFrame,
          });
        }
      }
    } else {
      // Legacy single-audio mode: global offset by intro
      words = (wordsRaw.words ?? []).map((w: { word: string; start: number; end: number }) => ({
        word: w.word,
        startFrame: Math.round(w.start * FPS) + DEFAULT_INTRO_FRAMES,
        endFrame: Math.round(w.end * FPS) + DEFAULT_INTRO_FRAMES,
      }));
    }
  }

  // Cursor trail → remapped to adjusted scene timeline
  const cursorTrail: MarkerCursorPoint[] = (markers.cursorTrail ?? []).map((c) => ({
    frame: remapFrame(msToFrames(c.ms)),
    x: c.x,
    y: c.y,
  }));

  // Total duration = sum of all scene durations (which may be extended for voice) + outro
  const contentFrames = currentFrame;
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
