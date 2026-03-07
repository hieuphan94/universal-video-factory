// Compose pipeline — assembles pre-recorded clips + narration into a video.
// Skips AI Director (Phase A) and Capture (Phase C) — reuses Voice (B), Remotion (E), Export (F).

import * as fs from "fs";
import * as path from "path";
import { CatalogManager } from "./catalog-manager.js";
import { buildComposeMetadata, saveComposeMetadata } from "./compose-metadata-builder.js";
import { runVoicePipeline } from "../voice/voice-pipeline.js";
import { renderVideo } from "../compositor/render-engine.js";
import { exportFinalVideo } from "../export/ffmpeg-exporter.js";
import { loadBrand, toRemotion } from "../compositor/brand-loader.js";
import type { ComposeManifest, ClipMetadata } from "./types.js";
import type { PipelineResult } from "../orchestrator/types.js";
import { createLogger } from "../utils/logger.js";

const log = createLogger("compose");

export interface ComposeOptions {
  manifest: ComposeManifest;
  outputDir: string;
  preview?: boolean;
  catalogDir?: string;
}

/**
 * Run the compose pipeline:
 * 1. Validate clips exist in catalog
 * 2. Generate script.txt from manifest narrations
 * 3. Voice TTS → audio + timestamps
 * 4. Build capture_metadata.json
 * 5. Copy clip videos to output/scenes/
 * 6. Remotion render → draft.mp4
 * 7. FFmpeg export → final.mp4
 */
export async function runComposePipeline(opts: ComposeOptions): Promise<PipelineResult> {
  const startedAt = Date.now();
  const { manifest, outputDir } = opts;

  try {
    // Create output directories
    const scenesDir = path.join(outputDir, "scenes");
    const audioDir = path.join(outputDir, "audio");
    fs.mkdirSync(scenesDir, { recursive: true });
    fs.mkdirSync(audioDir, { recursive: true });

    // Step 1: Load and validate clips
    const catalog = new CatalogManager(opts.catalogDir);
    const clips: ClipMetadata[] = [];
    for (const entry of manifest.clips) {
      const clip = catalog.getClip(entry.clipId);
      if (!clip) throw new Error(`Clip not found: "${entry.clipId}"`);
      if (!fs.existsSync(clip.videoPath)) {
        throw new Error(`Clip video missing: ${clip.videoPath}`);
      }
      clips.push(clip);
    }
    log.info(`Loaded ${clips.length} clip(s) from catalog`);

    // Step 2: Generate script.txt with [SCENE:XX] markers
    // Each scene gets a leading "..." pause so the viewer sees the screen
    // for ~1-2 seconds before narration begins (ElevenLabs renders "..." as silence).
    const scriptPath = path.join(outputDir, "script.txt");
    const scriptLines = manifest.clips.map((entry, i) => {
      const marker = `[SCENE:${String(i + 1).padStart(2, "0")}]`;
      return `${marker} ... ${entry.narration}`;
    });
    // Trailing silence so content finishes before outro kicks in
    scriptLines.push("... ... ...");
    fs.writeFileSync(scriptPath, scriptLines.join("\n\n\n"), "utf-8");
    log.info(`Generated script.txt (${manifest.clips.length} scenes)`);

    // Step 3: Voice TTS
    log.info("Running voice pipeline...");
    const voiceResult = await runVoicePipeline({
      scriptPath,
      outputDir,
      voiceId: manifest.voice,
      language: manifest.lang ?? "en",
    });
    log.info(`Voice done: ${voiceResult.totalDuration.toFixed(1)}s total`);

    // Step 4: Build capture_metadata.json
    const metadata = buildComposeMetadata(clips, voiceResult, outputDir);
    saveComposeMetadata(metadata, outputDir);

    // Step 5: Copy clip videos to output/scenes/ as scene-01.mp4, scene-02.mp4, ...
    for (let i = 0; i < clips.length; i++) {
      const destName = `scene-${String(i + 1).padStart(2, "0")}.mp4`;
      const destPath = path.join(scenesDir, destName);
      fs.copyFileSync(clips[i].videoPath, destPath);
    }
    log.info(`Copied ${clips.length} clip(s) to scenes/`);

    // Step 6: Remotion render
    log.info("Rendering with Remotion...");
    const draftPath = path.join(outputDir, "draft.mp4");
    const brand = await loadBrand(manifest.brand);
    toRemotion(brand);
    await renderVideo({
      projectDir: outputDir,
      outputPath: draftPath,
      codec: "h264",
      concurrency: 2,
    });

    // Step 7: FFmpeg export
    log.info("Exporting final video...");
    const suffix = opts.preview ? "720p" : "1080p";
    const finalPath = path.join(outputDir, `final_${suffix}.mp4`);
    const exportResult = await exportFinalVideo(draftPath, finalPath);

    const elapsedMs = Date.now() - startedAt;
    log.info(`Done in ${(elapsedMs / 1000).toFixed(1)}s → ${finalPath}`);

    return {
      success: true,
      elapsedMs,
      export: { finalPath, encoder: exportResult.encoder, durationMs: exportResult.durationMs },
    };
  } catch (err) {
    return {
      success: false,
      error: (err as Error).message,
      elapsedMs: Date.now() - startedAt,
    };
  }
}
