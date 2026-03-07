// Pipeline coordinator — voice-first E2E orchestration:
// A: AI Director → B: Voice (TTS+align) → C: Capture (voice-timed) → D: Convert → E: Render → F: Export
// Phase handlers extracted to phase-handler-*.ts for modularity.

import * as fs from "fs/promises";
import * as path from "path";
import { renderVideo } from "../compositor/render-engine.js";
import { loadBrand, toRemotion } from "../compositor/brand-loader.js";
import { exportFinalVideo } from "../export/ffmpeg-exporter.js";
import {
  saveCheckpoint,
  loadCheckpoint,
  isPhaseComplete,
  getPhaseData,
} from "./checkpoint-manager.js";
import { handleError } from "./error-handler.js";
import { runVoicePipeline } from "../voice/voice-pipeline.js";
import { runAIDirectorPhase } from "./phase-handler-ai-director.js";
import { runCapturePhase, convertScenesWebmToMp4 } from "./phase-handler-capture.js";
import { createLogger } from "../utils/logger.js";
import type { VoicePipelineResult } from "../voice/voice-pipeline.js";
import type { ProgressDisplay } from "../cli/progress-display.js";
import type { PipelineConfig, CaptureResult, PipelineResult, ExportPhaseResult } from "./types.js";
import type { BrowserConfig } from "../capture/types.js";

const log = createLogger("pipeline");

export interface PipelineRunOptions {
  resume?: boolean;
  preview?: boolean;
  progress?: ProgressDisplay;
}

interface OutputDirs {
  output: string;
  scenes: string;
  audio: string;
  temp: string;
}

export class PipelineCoordinator {
  private config: PipelineConfig;
  private opts: PipelineRunOptions;

  constructor(config: PipelineConfig, opts: PipelineRunOptions = {}) {
    this.config = config;
    this.opts = opts;
  }

  async run(): Promise<PipelineResult> {
    const startedAt = Date.now();
    log.info(`Starting for: ${this.config.url} — "${this.config.feature}"`);

    const checkpoint = this.opts.resume
      ? await loadCheckpoint(this.config.output)
      : null;

    if (checkpoint && this.opts.resume) {
      const done = checkpoint.completedPhases.map((p) => p.phase).join(", ");
      log.info(`Resuming — already completed: ${done}`);
    }

    try {
      const dirs = await this.createOutputDirs();
      const browserConfig = this.buildBrowserConfig();

      // ── Phase A: AI Director — screenshot → script + click plan ──
      let captureResult: CaptureResult;
      if (isPhaseComplete(checkpoint, "A")) {
        const data = getPhaseData(checkpoint, "A") as { clickPlanPath: string; scriptPath: string; metadataPath: string };
        log.info("Phase A: skipped (checkpoint)");
        captureResult = {
          scenes: [], scriptPath: data.scriptPath,
          clickPlanPath: data.clickPlanPath, metadataPath: data.metadataPath,
          outputDir: dirs.output,
        };
      } else {
        this.opts.progress?.startPhase("A", "AI Director — analyze + script");
        const t = Date.now();
        captureResult = await runAIDirectorPhase(this.config, browserConfig, dirs);
        await saveCheckpoint(dirs.output, "A", {
          clickPlanPath: captureResult.clickPlanPath,
          scriptPath: captureResult.scriptPath,
          metadataPath: captureResult.metadataPath,
        });
        this.opts.progress?.completePhase("A");
        log.info(`Phase A done in ${((Date.now() - t) / 1000).toFixed(1)}s`);
      }

      // ── Phase B: Voice pipeline — TTS + alignment (BEFORE capture) ──
      let voiceResult: VoicePipelineResult;
      if (isPhaseComplete(checkpoint, "B")) {
        const data = getPhaseData(checkpoint, "B") as {
          audioPath: string; timestampsPath: string;
          totalDuration: number; sceneDurations: VoicePipelineResult["sceneDurations"];
        };
        log.info("Phase B: skipped (checkpoint)");
        voiceResult = {
          audioPath: data.audioPath, timestampsPath: data.timestampsPath,
          totalDuration: data.totalDuration, sceneDurations: data.sceneDurations,
        };
      } else {
        this.opts.progress?.startPhase("B", "Voice — TTS + alignment");
        const t = Date.now();
        voiceResult = await runVoicePipeline({
          scriptPath: captureResult.scriptPath,
          outputDir: dirs.output,
          voiceId: this.config.voice ?? undefined,
          language: this.config.lang,
        });
        await saveCheckpoint(dirs.output, "B", {
          audioPath: voiceResult.audioPath,
          timestampsPath: voiceResult.timestampsPath,
          totalDuration: voiceResult.totalDuration,
          sceneDurations: voiceResult.sceneDurations,
        });
        this.opts.progress?.completePhase("B");
        log.info(`Phase B (voice) done in ${((Date.now() - t) / 1000).toFixed(1)}s`);
      }

      // ── Phase C: Capture — record video timed to voice narration ──
      if (!isPhaseComplete(checkpoint, "C")) {
        this.opts.progress?.startPhase("C", "Capture — voice-synced recording");
        const t = Date.now();
        await runCapturePhase(this.config, captureResult, browserConfig, dirs, voiceResult);
        await saveCheckpoint(dirs.output, "C", {});
        this.opts.progress?.completePhase("C");
        log.info(`Phase C (capture) done in ${((Date.now() - t) / 1000).toFixed(1)}s`);
      } else {
        log.info("Phase C: skipped (checkpoint)");
      }

      // ── Phase D: Convert .webm → .mp4 for Remotion ──
      if (!isPhaseComplete(checkpoint, "D")) {
        this.opts.progress?.startPhase("D", "Convert webm to mp4");
        const t = Date.now();
        await convertScenesWebmToMp4(dirs.scenes);
        await saveCheckpoint(dirs.output, "D", {});
        this.opts.progress?.completePhase("D");
        log.info(`Phase D (webm→mp4) done in ${((Date.now() - t) / 1000).toFixed(1)}s`);
      } else {
        log.info("Phase D: skipped (checkpoint)");
      }

      // ── Phase E: Remotion compositor → draft.mp4 ──
      const draftPath = path.join(dirs.output, "draft.mp4");
      if (!isPhaseComplete(checkpoint, "E")) {
        this.opts.progress?.startPhase("E", "Compositor — rendering");
        const t = Date.now();
        const brand = await loadBrand(this.config.brand);
        toRemotion(brand);
        await renderVideo({
          projectDir: dirs.output,
          outputPath: draftPath,
          codec: "h264",
          concurrency: 2,
        });
        await saveCheckpoint(dirs.output, "E", { draftPath });
        this.opts.progress?.completePhase("E");
        log.info(`Phase E (compositor) done in ${((Date.now() - t) / 1000).toFixed(1)}s`);
      } else {
        log.info("Phase E: skipped (checkpoint)");
      }

      // ── Phase F: FFmpeg HEVC export ──
      const suffix = this.opts.preview ? "720p" : "1080p";
      const finalPath = path.join(dirs.output, `final_${suffix}.mp4`);
      let exportPhase: ExportPhaseResult = { finalPath, encoder: "checkpoint", durationMs: 0 };
      if (!isPhaseComplete(checkpoint, "F")) {
        this.opts.progress?.startPhase("F", "FFmpeg export");
        const t = Date.now();
        const exportResult = await exportFinalVideo(draftPath, finalPath);
        exportPhase = { finalPath, encoder: exportResult.encoder, durationMs: exportResult.durationMs };
        await saveCheckpoint(dirs.output, "F", { finalPath });
        this.opts.progress?.completePhase("F");
        log.info(`Phase F (export/${exportResult.encoder}) done in ${((Date.now() - t) / 1000).toFixed(1)}s`);
      } else {
        log.info("Phase F: skipped (checkpoint)");
      }

      await this.cleanupTemp(dirs.temp);

      const elapsedMs = Date.now() - startedAt;
      log.info(`Complete in ${(elapsedMs / 1000).toFixed(1)}s → ${finalPath}`);

      return {
        capture: captureResult,
        export: exportPhase,
        success: true,
        elapsedMs,
      };
    } catch (err) {
      handleError(err as Error);
      return { success: false, error: (err as Error).message, elapsedMs: Date.now() - startedAt };
    }
  }

  private async cleanupTemp(tempDir: string): Promise<void> {
    try {
      await fs.rm(tempDir, { recursive: true, force: true });
      log.info(`Cleaned temp: ${tempDir}`);
    } catch {
      log.warn(`Could not clean temp dir: ${tempDir}`);
    }
  }

  private buildBrowserConfig(): BrowserConfig {
    return {
      viewportWidth: parseInt(process.env.VIEWPORT_WIDTH ?? "1920"),
      viewportHeight: parseInt(process.env.VIEWPORT_HEIGHT ?? "1080"),
      headless: true,
      cookiesPath: this.config.cookies,
      recordingFps: parseInt(process.env.SCENE_RECORDING_FPS ?? "30"),
      pageLoadTimeoutMs: parseInt(process.env.PAGE_LOAD_TIMEOUT_MS ?? "30000"),
      clickActionTimeoutMs: parseInt(process.env.CLICK_ACTION_TIMEOUT_MS ?? "10000"),
    };
  }

  private async createOutputDirs(): Promise<OutputDirs> {
    const output = this.config.output;
    const dirs: OutputDirs = {
      output,
      scenes: path.join(output, "scenes"),
      audio: path.join(output, "audio"),
      temp: path.join(output, "temp"),
    };
    for (const dir of Object.values(dirs)) {
      await fs.mkdir(dir, { recursive: true });
    }
    log.info(`Output directory: ${output}`);
    return dirs;
  }
}
