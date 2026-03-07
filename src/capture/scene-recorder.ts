// Scene recorder — voice-first: records video timed to narration durations.
// ONE continuous browser recording. Each scene pauses for exactly the narration duration.
// Result: video and voice are perfectly synchronized.

import * as fs from "fs/promises";
import * as path from "path";
import type { Page } from "playwright";
import { chromium } from "playwright";
import type { PlannedAction } from "../ai-director/types.js";
import type { BrowserConfig, SceneRecordingResult } from "./types.js";
import { CursorTracker } from "./cursor-tracker.js";
import { executeAction, waitForStability } from "./action-executor.js";
import type { SceneDuration } from "../voice/voice-pipeline.js";
import { createLogger } from "../utils/logger.js";

const log = createLogger("scene-recorder");

// Minimum buffer after action before scene ends (let result be visible)
const POST_ACTION_BUFFER_MS = 1000;

export class SceneRecorder {
  private config: BrowserConfig;
  private retryAttempts: number;

  constructor(config: BrowserConfig, retryAttempts = 2) {
    this.config = config;
    this.retryAttempts = retryAttempts;
  }

  /**
   * Record all scenes in ONE continuous video, timed to voice narration.
   * Each scene lasts max(narrationDuration, actionTime + buffer).
   * This ensures video and voice are perfectly synchronized.
   */
  async recordAllScenes(
    actions: PlannedAction[],
    url: string,
    scenesDir: string,
    tempDir: string,
    sceneDurations?: SceneDuration[]
  ): Promise<SceneRecordingResult[]> {
    await fs.mkdir(scenesDir, { recursive: true });

    const videoDir = path.join(tempDir, "continuous-recording");
    await fs.mkdir(videoDir, { recursive: true });

    const browser = await chromium.launch({ headless: this.config.headless });
    const context = await browser.newContext({
      viewport: { width: this.config.viewportWidth, height: this.config.viewportHeight },
      recordVideo: {
        dir: videoDir,
        size: { width: this.config.viewportWidth, height: this.config.viewportHeight },
      },
    });

    const page = await context.newPage();
    const cursorTracker = new CursorTracker();
    page.setDefaultTimeout(this.config.clickActionTimeoutMs);
    page.setDefaultNavigationTimeout(this.config.pageLoadTimeoutMs);

    const results: SceneRecordingResult[] = [];
    const sessionStart = Date.now();

    try {
      await cursorTracker.startTracking(page);
      await page.goto(url, { waitUntil: "networkidle", timeout: this.config.pageLoadTimeoutMs });

      // Brief initial pause so page is visible before first action
      await page.waitForTimeout(500);

      for (let i = 0; i < actions.length; i++) {
        const action = actions[i];
        // Get narration duration for this scene (in ms), default 5s if no voice data
        const narrationMs = sceneDurations?.[i]
          ? sceneDurations[i].durationSec * 1000
          : 5000;

        log.info(
          `Scene ${action.sceneIndex}: ${action.description} ` +
          `(target: ${(narrationMs / 1000).toFixed(1)}s)`
        );
        const sceneStart = Date.now();

        try {
          // Execute the action (click, type, press key, etc)
          await this.runAction(page, action);
          await waitForStability(page, action);

          // Calculate remaining time: scene should last at least narrationMs
          const actionElapsed = Date.now() - sceneStart;
          const targetMs = Math.max(narrationMs, actionElapsed + POST_ACTION_BUFFER_MS);
          const remainingMs = targetMs - actionElapsed;

          if (remainingMs > 0) {
            await page.waitForTimeout(remainingMs);
          }

          const durationMs = Date.now() - sceneStart;
          log.info(`Scene ${String(action.sceneIndex).padStart(2, "0")} recorded (${(durationMs / 1000).toFixed(1)}s)`);
          results.push({
            sceneIndex: action.sceneIndex,
            videoPath: "",
            durationMs,
            success: true,
          });
        } catch (err) {
          const errorMsg = (err as Error).message;
          log.error(`Scene ${action.sceneIndex} failed: ${errorMsg}`);
          results.push({
            sceneIndex: action.sceneIndex,
            videoPath: "",
            durationMs: Date.now() - sceneStart,
            success: false,
            error: errorMsg,
          });
        }
      }

      cursorTracker.flushEvents();
    } finally {
      await page.close();
      await context.close();
      await browser.close();
    }

    // Move the single recorded video to scenes/ directory
    const rawVideos = await fs.readdir(videoDir);
    const videoFile = rawVideos.find((f) => f.endsWith(".webm"));
    const outputVideoPath = path.join(scenesDir, "scene-01.webm");

    if (videoFile) {
      await fs.rename(path.join(videoDir, videoFile), outputVideoPath);
    }

    for (const r of results) {
      if (r.success) r.videoPath = outputVideoPath;
    }

    const totalMs = Date.now() - sessionStart;
    log.info(`All ${results.length} scene(s) recorded in ${(totalMs / 1000).toFixed(1)}s`);

    return results;
  }

  /** Execute action using shared action-executor module */
  private async runAction(page: Page, action: PlannedAction): Promise<void> {
    if (action.useFallback) {
      await this.executeStagehandFallback(page, action);
    } else {
      await executeAction(page, {
        x: action.x,
        y: action.y,
        selector: action.selector,
        description: action.description,
        waitFor: action.waitFor,
        waitMs: action.waitMs,
      }, this.retryAttempts);
    }
  }

  /** Stagehand natural-language fallback for low-confidence actions */
  private async executeStagehandFallback(page: Page, action: PlannedAction): Promise<void> {
    log.info(`Using Stagehand fallback for: "${action.description}"`);
    try {
      const { Stagehand } = await import("@browserbasehq/stagehand");
      const stagehand = new Stagehand({ env: "LOCAL", verbose: 0, enableCaching: false });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await stagehand.init({ modelName: "claude-sonnet-4-6" as any });
      await stagehand.page.act(action.description);
      await stagehand.close();
    } catch (err) {
      log.warn(`Stagehand unavailable, using action-executor: ${(err as Error).message}`);
      await executeAction(page, {
        x: action.x, y: action.y,
        selector: action.selector,
        description: action.description,
      }, this.retryAttempts);
    }
  }
}
