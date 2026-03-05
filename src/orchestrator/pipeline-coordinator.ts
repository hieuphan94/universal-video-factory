// Pipeline coordinator — full E2E orchestration:
// AI Director → Capture → Convert webm → Compositor → FFmpeg HEVC export

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

      // Phase A: AI Director — screenshot → script + click plan
      let captureResult: CaptureResult;
      if (isPhaseComplete(checkpoint, "A")) {
        const data = getPhaseData(checkpoint, "A") as { clickPlanPath: string; scriptPath: string; metadataPath: string };
        console.log("[Pipeline] Phase A: skipped (checkpoint)");
        captureResult = {
          scenes: [],
          scriptPath: data.scriptPath,
          clickPlanPath: data.clickPlanPath,
          metadataPath: data.metadataPath,
          outputDir: dirs.output,
        };
      } else {
        this.opts.progress?.startPhase("A", "AI Director — analyze + script");
        const phaseA = Date.now();
        captureResult = await this.runAIDirectorPhase(dirs);
        await saveCheckpoint(dirs.output, "A", {
          clickPlanPath: captureResult.clickPlanPath,
          scriptPath: captureResult.scriptPath,
          metadataPath: captureResult.metadataPath,
        });
        this.opts.progress?.completePhase("A");
        console.log(`[Pipeline] Phase A done in ${((Date.now() - phaseA) / 1000).toFixed(1)}s`);
      }

      // Phase B: Capture — execute click plan, record scenes
      if (!isPhaseComplete(checkpoint, "B")) {
        this.opts.progress?.startPhase("B", "Capture — recording scenes");
        const phaseB = Date.now();
        await this.runCapturePhase(captureResult, dirs);
        await saveCheckpoint(dirs.output, "B", {});
        this.opts.progress?.completePhase("B");
        console.log(`[Pipeline] Phase B done in ${((Date.now() - phaseB) / 1000).toFixed(1)}s`);
      } else {
        console.log("[Pipeline] Phase B: skipped (checkpoint)");
      }

      // Phase C: Convert .webm → .mp4 for Remotion
      if (!isPhaseComplete(checkpoint, "C")) {
        this.opts.progress?.startPhase("C", "Convert webm to mp4");
        const phaseC = Date.now();
        await this.convertScenesWebmToMp4(dirs);
        await saveCheckpoint(dirs.output, "C", {});
        this.opts.progress?.completePhase("C");
        console.log(`[Pipeline] Phase C (webm→mp4) done in ${((Date.now() - phaseC) / 1000).toFixed(1)}s`);
      } else {
        console.log("[Pipeline] Phase C: skipped (checkpoint)");
      }

      // Phase C2: Voice pipeline — TTS + WhisperX alignment → words_timestamps.json
      if (!isPhaseComplete(checkpoint, "C2")) {
        this.opts.progress?.startPhase("C2", "Voice — TTS + alignment");
        const phaseC2 = Date.now();
        const voiceResult = await runVoicePipeline({
          scriptPath: captureResult.scriptPath,
          outputDir: dirs.output,
          voiceId: this.config.voice ?? undefined,
          language: this.config.lang,
        });

        // Update capture_metadata.json with audio info and scene timing from voice
        await this.updateMetadataWithVoice(captureResult.metadataPath, voiceResult.audioPath, voiceResult.totalDuration);

        await saveCheckpoint(dirs.output, "C2", {
          audioPath: voiceResult.audioPath,
          timestampsPath: voiceResult.timestampsPath,
        });
        this.opts.progress?.completePhase("C2");
        console.log(`[Pipeline] Phase C2 (voice) done in ${((Date.now() - phaseC2) / 1000).toFixed(1)}s`);
      } else {
        console.log("[Pipeline] Phase C2: skipped (checkpoint)");
      }

      // Phase D: Remotion compositor → draft.mp4
      const draftPath = path.join(dirs.output, "draft.mp4");
      if (!isPhaseComplete(checkpoint, "D")) {
        this.opts.progress?.startPhase("D", "Compositor — rendering");
        const phaseD = Date.now();
        const brand = await loadBrand(this.config.brand);
        toRemotion(brand); // validate brand maps correctly
        const renderCodec = this.opts.preview ? "h264" : "h264";
        await renderVideo({
          projectDir: dirs.output,
          outputPath: draftPath,
          codec: renderCodec,
          concurrency: 4,
        });
        await saveCheckpoint(dirs.output, "D", { draftPath });
        this.opts.progress?.completePhase("D");
        console.log(`[Pipeline] Phase D (compositor) done in ${((Date.now() - phaseD) / 1000).toFixed(1)}s`);
      } else {
        console.log("[Pipeline] Phase D: skipped (checkpoint)");
      }

      // Phase E: FFmpeg HEVC export
      this.opts.progress?.startPhase("E", "FFmpeg export");
      const phaseE = Date.now();
      const suffix = this.opts.preview ? "720p" : "1080p";
      const finalPath = path.join(dirs.output, `final_${suffix}.mp4`);
      const exportResult = await exportFinalVideo(draftPath, finalPath);
      await saveCheckpoint(dirs.output, "E", { finalPath });
      this.opts.progress?.completePhase("E");
      console.log(`[Pipeline] Phase E (export/${exportResult.encoder}) done in ${((Date.now() - phaseE) / 1000).toFixed(1)}s`);

      // Cleanup temp files
      await this.cleanupTemp(dirs.temp);

      const elapsedMs = Date.now() - startedAt;
      console.log(`[Pipeline] Complete in ${(elapsedMs / 1000).toFixed(1)}s → ${finalPath}`);

      const exportPhase: ExportPhaseResult = {
        finalPath,
        encoder: exportResult.encoder,
        durationMs: exportResult.durationMs,
      };

      return {
        capture: captureResult,
        export: exportPhase,
        success: true,
        elapsedMs,
      };
    } catch (err) {
      handleError(err as Error);
      return {
        success: false,
        error: (err as Error).message,
        elapsedMs: Date.now() - startedAt,
      };
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
    const script = await scriptGen.generate(
      analysis.elements,
      this.config.feature,
      this.config.lang,
      dirs.output
    );
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

  /** Phase B: Execute click plan via Playwright, record scenes */
  private async runCapturePhase(captureResult: CaptureResult, dirs: OutputDirs): Promise<void> {
    const raw = await fs.readFile(captureResult.clickPlanPath, "utf-8");
    const clickPlan = JSON.parse(raw);

    const browserConfig = this.buildBrowserConfig();
    const recorder = new SceneRecorder(browserConfig, parseInt(process.env.CLICK_RETRY_ATTEMPTS ?? "2"));

    console.log(`[Pipeline] Phase B: Recording ${clickPlan.actions.length} scene(s)...`);
    const results = await recorder.recordAllScenes(
      clickPlan.actions,
      this.config.url,
      dirs.scenes,
      dirs.temp
    );

    const metadata: CaptureMetadata = {
      url: this.config.url,
      feature: this.config.feature,
      capturedAt: new Date().toISOString(),
      viewportWidth: this.buildBrowserConfig().viewportWidth,
      viewportHeight: this.buildBrowserConfig().viewportHeight,
      fps: this.buildBrowserConfig().recordingFps,
      totalScenes: results.length,
      scenes: results.map((r, i) => ({
        index: r.sceneIndex,
        videoFile: path.basename(r.videoPath),
        durationMs: r.durationMs,
        clickX: clickPlan.actions[i]?.x ?? 0,
        clickY: clickPlan.actions[i]?.y ?? 0,
        actionDescription: clickPlan.actions[i]?.description ?? "",
        usedFallback: clickPlan.actions[i]?.useFallback ?? false,
        cursorEvents: [],
      })),
    };

    await fs.writeFile(captureResult.metadataPath, JSON.stringify(metadata, null, 2), "utf-8");
    const successCount = results.filter((r) => r.success).length;
    console.log(`[Pipeline] Recorded ${successCount}/${results.length} scene(s) successfully`);
  }

  /** Phase C: Convert all .webm files in scenes/ to .mp4 */
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
        await fs.unlink(inputPath); // remove source webm after conversion
      })
    );
  }

  /** Remove temp directory contents after successful pipeline run */
  private async cleanupTemp(tempDir: string): Promise<void> {
    try {
      await fs.rm(tempDir, { recursive: true, force: true });
      console.log(`[Pipeline] Cleaned temp: ${tempDir}`);
    } catch {
      // Non-fatal — log and continue
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

  /**
   * Update capture_metadata.json with audio file path, total duration,
   * and scene start/end times derived from voice timestamps.
   * This bridges the capture metadata format to what scene-timing-mapper expects.
   */
  private async updateMetadataWithVoice(
    metadataPath: string,
    audioPath: string,
    totalDuration: number
  ): Promise<void> {
    const raw = await fs.readFile(metadataPath, "utf-8");
    const metadata = JSON.parse(raw);

    // Read words_timestamps.json to get scene boundaries
    const tsPath = path.join(path.dirname(metadataPath), "words_timestamps.json");
    const tsRaw = await fs.readFile(tsPath, "utf-8");
    const timestamps = JSON.parse(tsRaw);

    // Map scene boundaries from voice timestamps onto capture metadata
    metadata.audioFile = path.relative(path.dirname(metadataPath), audioPath);
    metadata.totalDuration = totalDuration;
    metadata.scenes = metadata.scenes.map((scene: Record<string, unknown>, i: number) => {
      const boundary = timestamps.scenes?.[i];
      // Ensure video references point to .mp4 (Phase C converts .webm → .mp4)
      const rawFile = String(scene.videoFile ?? `scene-${String(i + 1).padStart(2, "0")}.mp4`);
      const baseName = rawFile.replace(/^scenes\//, "").replace(/\.webm$/, ".mp4");
      return {
        ...scene,
        id: boundary?.id ?? `SCENE:${String(i + 1).padStart(2, "0")}`,
        videoFile: `scenes/${baseName}`,
        start: boundary?.start_time ?? 0,
        end: boundary?.end_time ?? totalDuration,
      };
    });

    await fs.writeFile(metadataPath, JSON.stringify(metadata, null, 2), "utf-8");
    console.log("[Pipeline] Updated capture_metadata.json with voice timing");
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
