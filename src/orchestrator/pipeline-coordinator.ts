// Pipeline coordinator — voice-first E2E orchestration:
// A: AI Director → B: Voice (TTS+align) → C: Capture (voice-timed) → D: Convert → E: Render → F: Export
// Voice is generated BEFORE capture so video recording matches narration timing exactly.

import * as fs from "fs/promises";
import * as path from "path";
import { ScreenshotAnalyzer } from "../ai-director/screenshot-analyzer.js";
import { ScriptGenerator } from "../ai-director/script-generator.js";
import { ClickPlanBuilder } from "../ai-director/click-plan-builder.js";
import { BrowserManager } from "../capture/browser-manager.js";
import { SceneRecorder } from "../capture/scene-recorder.js";
import { renderVideo } from "../compositor/render-engine.js";
import { loadBrand, toRemotion } from "../compositor/brand-loader.js";
import { convertWebmToMp4, exportFinalVideo } from "../export/ffmpeg-exporter.js";
import {
  saveCheckpoint,
  loadCheckpoint,
  isPhaseComplete,
  getPhaseData,
} from "./checkpoint-manager.js";
import { handleError } from "./error-handler.js";
import { runVoicePipeline } from "../voice/voice-pipeline.js";
import type { VoicePipelineResult } from "../voice/voice-pipeline.js";
import type { ProgressDisplay } from "../cli/progress-display.js";
import type { PipelineConfig, CaptureResult, PipelineResult, ExportPhaseResult } from "./types.js";
import type { DirectorConfig } from "../ai-director/types.js";
import type { BrowserConfig, CaptureMetadata } from "../capture/types.js";

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
    console.log(`[Pipeline] Starting for: ${this.config.url} — "${this.config.feature}"`);

    const checkpoint = this.opts.resume
      ? await loadCheckpoint(this.config.output)
      : null;

    if (checkpoint && this.opts.resume) {
      const done = checkpoint.completedPhases.map((p) => p.phase).join(", ");
      console.log(`[Pipeline] Resuming — already completed: ${done}`);
    }

    try {
      const dirs = await this.createOutputDirs();

      // ── Phase A: AI Director — screenshot → script + click plan ──
      let captureResult: CaptureResult;
      if (isPhaseComplete(checkpoint, "A")) {
        const data = getPhaseData(checkpoint, "A") as { clickPlanPath: string; scriptPath: string; metadataPath: string };
        console.log("[Pipeline] Phase A: skipped (checkpoint)");
        captureResult = {
          scenes: [], scriptPath: data.scriptPath,
          clickPlanPath: data.clickPlanPath, metadataPath: data.metadataPath,
          outputDir: dirs.output,
        };
      } else {
        this.opts.progress?.startPhase("A", "AI Director — analyze + script");
        const t = Date.now();
        captureResult = await this.runAIDirectorPhase(dirs);
        await saveCheckpoint(dirs.output, "A", {
          clickPlanPath: captureResult.clickPlanPath,
          scriptPath: captureResult.scriptPath,
          metadataPath: captureResult.metadataPath,
        });
        this.opts.progress?.completePhase("A");
        console.log(`[Pipeline] Phase A done in ${((Date.now() - t) / 1000).toFixed(1)}s`);
      }

      // ── Phase B: Voice pipeline — TTS + alignment (BEFORE capture) ──
      let voiceResult: VoicePipelineResult;
      if (isPhaseComplete(checkpoint, "B")) {
        const data = getPhaseData(checkpoint, "B") as {
          audioPath: string; timestampsPath: string;
          totalDuration: number; sceneDurations: VoicePipelineResult["sceneDurations"];
        };
        console.log("[Pipeline] Phase B: skipped (checkpoint)");
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
        console.log(`[Pipeline] Phase B (voice) done in ${((Date.now() - t) / 1000).toFixed(1)}s`);
      }

      // ── Phase C: Capture — record video timed to voice narration ──
      if (!isPhaseComplete(checkpoint, "C")) {
        this.opts.progress?.startPhase("C", "Capture — voice-synced recording");
        const t = Date.now();
        await this.runCapturePhase(captureResult, dirs, voiceResult);
        await saveCheckpoint(dirs.output, "C", {});
        this.opts.progress?.completePhase("C");
        console.log(`[Pipeline] Phase C (capture) done in ${((Date.now() - t) / 1000).toFixed(1)}s`);
      } else {
        console.log("[Pipeline] Phase C: skipped (checkpoint)");
      }

      // ── Phase D: Convert .webm → .mp4 for Remotion ──
      if (!isPhaseComplete(checkpoint, "D")) {
        this.opts.progress?.startPhase("D", "Convert webm to mp4");
        const t = Date.now();
        await this.convertScenesWebmToMp4(dirs);
        await saveCheckpoint(dirs.output, "D", {});
        this.opts.progress?.completePhase("D");
        console.log(`[Pipeline] Phase D (webm→mp4) done in ${((Date.now() - t) / 1000).toFixed(1)}s`);
      } else {
        console.log("[Pipeline] Phase D: skipped (checkpoint)");
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
          concurrency: 4,
        });
        await saveCheckpoint(dirs.output, "E", { draftPath });
        this.opts.progress?.completePhase("E");
        console.log(`[Pipeline] Phase E (compositor) done in ${((Date.now() - t) / 1000).toFixed(1)}s`);
      } else {
        console.log("[Pipeline] Phase E: skipped (checkpoint)");
      }

      // ── Phase F: FFmpeg HEVC export ──
      this.opts.progress?.startPhase("F", "FFmpeg export");
      const t = Date.now();
      const suffix = this.opts.preview ? "720p" : "1080p";
      const finalPath = path.join(dirs.output, `final_${suffix}.mp4`);
      const exportResult = await exportFinalVideo(draftPath, finalPath);
      await saveCheckpoint(dirs.output, "F", { finalPath });
      this.opts.progress?.completePhase("F");
      console.log(`[Pipeline] Phase F (export/${exportResult.encoder}) done in ${((Date.now() - t) / 1000).toFixed(1)}s`);

      await this.cleanupTemp(dirs.temp);

      const elapsedMs = Date.now() - startedAt;
      console.log(`[Pipeline] Complete in ${(elapsedMs / 1000).toFixed(1)}s → ${finalPath}`);

      return {
        capture: captureResult,
        export: { finalPath, encoder: exportResult.encoder, durationMs: exportResult.durationMs },
        success: true,
        elapsedMs,
      };
    } catch (err) {
      handleError(err as Error);
      return { success: false, error: (err as Error).message, elapsedMs: Date.now() - startedAt };
    }
  }

  /** Phase A: Screenshot → Claude Vision → Script + Click Plan */
  private async runAIDirectorPhase(dirs: OutputDirs): Promise<CaptureResult> {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not set. Add it to .env.local");

    const directorConfig: DirectorConfig = {
      anthropicApiKey: apiKey,
      model: "claude-sonnet-4-6",
      confidenceThreshold: parseFloat(process.env.CLAUDE_VISION_CONFIDENCE_THRESHOLD ?? "0.7"),
      viewportWidth: parseInt(process.env.VIEWPORT_WIDTH ?? "1920"),
      viewportHeight: parseInt(process.env.VIEWPORT_HEIGHT ?? "1080"),
    };

    const browserConfig = this.buildBrowserConfig();
    const browserManager = new BrowserManager(browserConfig);

    console.log("[Pipeline] Phase A: Launching browser for screenshot...");
    await browserManager.launch(dirs.temp);
    let screenshotPath = "";

    try {
      await browserManager.navigateTo(this.config.url);

      if (this.config.manual) {
        console.log("[Pipeline] MANUAL MODE — press Enter after navigating to desired state...");
        await new Promise<void>((resolve) => process.stdin.once("data", () => resolve()));
      }

      screenshotPath = path.join(dirs.temp, "initial-screenshot.png");
      await browserManager.screenshot(screenshotPath);
      console.log(`[Pipeline] Screenshot saved: ${screenshotPath}`);
    } finally {
      await browserManager.close();
    }

    const analyzer = new ScreenshotAnalyzer(directorConfig);
    console.log("[Pipeline] Analyzing screenshot with Claude Vision...");
    const analysis = await analyzer.analyze(screenshotPath, this.config.feature);
    console.log(`[Pipeline] Found ${analysis.elements.length} relevant element(s)`);

    const scriptGen = new ScriptGenerator(directorConfig);
    console.log("[Pipeline] Generating script...");
    const script = await scriptGen.generate(analysis.elements, this.config.feature, this.config.lang, dirs.output);
    console.log(`[Pipeline] Script has ${script.scenes.length} scene(s)`);

    const planBuilder = new ClickPlanBuilder(directorConfig);
    const clickPlan = planBuilder.build(script, analysis.elements, this.config.url, this.config.feature);
    const clickPlanPath = await planBuilder.save(clickPlan, dirs.output);

    return {
      scenes: [],
      scriptPath: path.join(dirs.output, "script.txt"),
      clickPlanPath,
      metadataPath: path.join(dirs.output, "capture_metadata.json"),
      outputDir: dirs.output,
    };
  }

  /** Phase C: Record video with voice-driven timing per scene */
  private async runCapturePhase(
    captureResult: CaptureResult,
    dirs: OutputDirs,
    voiceResult: VoicePipelineResult
  ): Promise<void> {
    const raw = await fs.readFile(captureResult.clickPlanPath, "utf-8");
    const clickPlan = JSON.parse(raw);
    const browserConfig = this.buildBrowserConfig();
    const recorder = new SceneRecorder(browserConfig, parseInt(process.env.CLICK_RETRY_ATTEMPTS ?? "2"));

    console.log(`[Pipeline] Phase C: Recording ${clickPlan.actions.length} scene(s) with voice timing...`);
    const results = await recorder.recordAllScenes(
      clickPlan.actions,
      this.config.url,
      dirs.scenes,
      dirs.temp,
      voiceResult.sceneDurations
    );

    // Build capture metadata — scenes reference the single continuous video
    const metadata: CaptureMetadata = {
      url: this.config.url,
      feature: this.config.feature,
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
    console.log(`[Pipeline] Recorded ${successCount}/${results.length} scene(s) successfully`);
  }

  /** Phase D: Convert all .webm files in scenes/ to .mp4 */
  private async convertScenesWebmToMp4(dirs: OutputDirs): Promise<void> {
    const entries = await fs.readdir(dirs.scenes);
    const webmFiles = entries.filter((f) => f.endsWith(".webm"));
    if (webmFiles.length === 0) {
      console.log("[Pipeline] No .webm files found — skipping conversion");
      return;
    }
    console.log(`[Pipeline] Converting ${webmFiles.length} .webm file(s) to .mp4...`);
    await Promise.all(
      webmFiles.map(async (file) => {
        const inputPath = path.join(dirs.scenes, file);
        const outputPath = path.join(dirs.scenes, file.replace(/\.webm$/, ".mp4"));
        await convertWebmToMp4(inputPath, outputPath);
        await fs.unlink(inputPath);
      })
    );
  }

  private async cleanupTemp(tempDir: string): Promise<void> {
    try {
      await fs.rm(tempDir, { recursive: true, force: true });
      console.log(`[Pipeline] Cleaned temp: ${tempDir}`);
    } catch {
      console.warn(`[Pipeline] Could not clean temp dir: ${tempDir}`);
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
    console.log(`[Pipeline] Output directory: ${output}`);
    return dirs;
  }
}
