// Phase C+D handlers — Screen capture + webm→mp4 conversion
// Extracted from pipeline-coordinator.ts to keep it under 200 lines.

import * as fs from "fs/promises";
import * as path from "path";
import { SceneRecorder } from "../capture/scene-recorder.js";
import { convertWebmToMp4 } from "../export/ffmpeg-exporter.js";
import type { PipelineConfig, CaptureResult } from "./types.js";
import type { BrowserConfig, CaptureMetadata } from "../capture/types.js";
import type { VoicePipelineResult } from "../voice/voice-pipeline.js";
import { createLogger } from "../utils/logger.js";

const log = createLogger("pipeline");

/** Run Phase C: Record video with voice-driven timing per scene */
export async function runCapturePhase(
  config: PipelineConfig,
  captureResult: CaptureResult,
  browserConfig: BrowserConfig,
  dirs: { output: string; scenes: string; temp: string },
  voiceResult: VoicePipelineResult
): Promise<void> {
  const raw = await fs.readFile(captureResult.clickPlanPath, "utf-8");
  const clickPlan = JSON.parse(raw);
  const recorder = new SceneRecorder(browserConfig, parseInt(process.env.CLICK_RETRY_ATTEMPTS ?? "2"));

  log.info(`Phase C: Recording ${clickPlan.actions.length} scene(s) with voice timing...`);
  const results = await recorder.recordAllScenes(
    clickPlan.actions,
    config.url,
    dirs.scenes,
    dirs.temp,
    voiceResult.sceneDurations
  );

  // Build capture metadata — scenes reference the single continuous video
  const metadata: CaptureMetadata = {
    url: config.url,
    feature: config.feature,
    capturedAt: new Date().toISOString(),
    viewportWidth: browserConfig.viewportWidth,
    viewportHeight: browserConfig.viewportHeight,
    fps: browserConfig.recordingFps,
    totalScenes: results.length,
    scenes: results.map((r, i) => ({
      index: r.sceneIndex,
      videoFile: r.videoPath ? path.basename(r.videoPath) : `scene-01.mp4`,
      durationMs: r.durationMs,
      clickX: clickPlan.actions[i]?.x ?? 0,
      clickY: clickPlan.actions[i]?.y ?? 0,
      actionDescription: clickPlan.actions[i]?.description ?? "",
      usedFallback: clickPlan.actions[i]?.useFallback ?? false,
      cursorEvents: [],
    })),
  };

  // Merge voice timing directly into metadata (since voice ran before capture)
  const tsRaw = await fs.readFile(voiceResult.timestampsPath, "utf-8");
  const timestamps = JSON.parse(tsRaw);

  metadata.audioFile = path.relative(dirs.output, voiceResult.audioPath);
  metadata.totalDuration = voiceResult.totalDuration;
  metadata.scenes = metadata.scenes.map((scene, i) => {
    const boundary = timestamps.scenes?.[i];
    const baseName = scene.videoFile.replace(/\.webm$/, ".mp4");
    return {
      ...scene,
      id: boundary?.id ?? `SCENE:${String(i + 1).padStart(2, "0")}`,
      videoFile: `scenes/${baseName}`,
      start: boundary?.start_time ?? 0,
      end: boundary?.end_time ?? voiceResult.totalDuration,
    };
  });

  await fs.writeFile(captureResult.metadataPath, JSON.stringify(metadata, null, 2), "utf-8");
  const successCount = results.filter((r) => r.success).length;
  log.info(`Recorded ${successCount}/${results.length} scene(s) successfully`);
}

/** Run Phase D: Convert all .webm files in scenes/ to .mp4 */
export async function convertScenesWebmToMp4(scenesDir: string): Promise<void> {
  const entries = await fs.readdir(scenesDir);
  const webmFiles = entries.filter((f) => f.endsWith(".webm"));
  if (webmFiles.length === 0) {
    log.info("No .webm files found — skipping conversion");
    return;
  }
  log.info(`Converting ${webmFiles.length} .webm file(s) to .mp4...`);
  await Promise.all(
    webmFiles.map(async (file) => {
      const inputPath = path.join(scenesDir, file);
      const outputPath = path.join(scenesDir, file.replace(/\.webm$/, ".mp4"));
      await convertWebmToMp4(inputPath, outputPath);
      await fs.unlink(inputPath);
    })
  );
}
