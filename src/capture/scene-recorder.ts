// Scene recorder — executes click plan actions via Playwright in ONE continuous recording.
// Records a single video of the entire session, with timestamp markers per scene.
// No per-scene browser restarts = no white flash between scenes.

import * as fs from "fs/promises";
import * as path from "path";
import type { Page } from "playwright";
import { chromium } from "playwright";
import type { PlannedAction } from "../ai-director/types.js";
import type { BrowserConfig, SceneRecordingResult } from "./types.js";
import { CursorTracker } from "./cursor-tracker.js";

// Delay after typing each character for natural typing appearance
const TYPING_DELAY_MS = 100;
// Pause after an action completes so the result is visible on screen
const POST_ACTION_PAUSE_MS = 3000;
// Minimum visible duration per scene — must be long enough to match narration (~6-7s per scene)
const MIN_SCENE_DISPLAY_MS = 6000;

export class SceneRecorder {
  private config: BrowserConfig;
  private retryAttempts: number;

  constructor(config: BrowserConfig, retryAttempts = 2) {
    this.config = config;
    this.retryAttempts = retryAttempts;
  }

  /**
   * Record all scenes in ONE continuous video session.
   * A single browser context records the entire interaction flow.
   * Returns per-scene results with timing info; the video is one file
   * that the pipeline later references as all scenes pointing to the same video.
   */
  async recordAllScenes(
    actions: PlannedAction[],
    url: string,
    scenesDir: string,
    tempDir: string
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

      // Brief initial pause so the page is visible before any action
      await page.waitForTimeout(800);

      for (const action of actions) {
        console.log(`[SceneRecorder] Recording scene ${action.sceneIndex}: ${action.description}`);
        const sceneStart = Date.now();

        try {
          await this.executeAction(page, action);
          await this.waitForStability(page, action);
          await page.waitForTimeout(POST_ACTION_PAUSE_MS);

          // Ensure minimum scene duration
          const elapsed = Date.now() - sceneStart;
          if (elapsed < MIN_SCENE_DISPLAY_MS) {
            await page.waitForTimeout(MIN_SCENE_DISPLAY_MS - elapsed);
          }

          const durationMs = Date.now() - sceneStart;
          console.log(`[SceneRecorder] Scene ${String(action.sceneIndex).padStart(2, "0")} recorded (${durationMs}ms)`);
          results.push({
            sceneIndex: action.sceneIndex,
            videoPath: "", // filled after video is saved
            durationMs,
            success: true,
          });
        } catch (err) {
          const errorMsg = (err as Error).message;
          console.error(`[SceneRecorder] Scene ${action.sceneIndex} failed: ${errorMsg}`);
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
      // Close page + context to flush the video file
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

    // All scenes point to the same continuous video file
    for (const r of results) {
      if (r.success) r.videoPath = outputVideoPath;
    }

    const totalMs = Date.now() - sessionStart;
    console.log(`[SceneRecorder] All ${results.length} scene(s) recorded in ${(totalMs / 1000).toFixed(1)}s`);

    return results;
  }

  /** Execute action — parses description for click, type, and keyboard actions */
  private async executeAction(page: Page, action: PlannedAction): Promise<void> {
    const desc = action.description.toLowerCase();

    // Skip "no action" scenes (intro/outro/confirmation)
    if (desc.includes("no action") || desc.includes("observe")) return;

    for (let attempt = 1; attempt <= this.retryAttempts; attempt++) {
      try {
        if (action.useFallback) {
          await this.executeStagehandFallback(page, action);
        } else {
          await this.executeSmartAction(page, action);
        }
        console.log(`[SceneRecorder] Action executed (attempt ${attempt}): ${action.description}`);
        return;
      } catch (err) {
        console.warn(`[SceneRecorder] Attempt ${attempt} failed: ${(err as Error).message}`);
        if (attempt === this.retryAttempts) throw err;
        await page.waitForTimeout(500);
      }
    }
  }

  /**
   * Smart action execution — interprets the action description to determine
   * what Playwright commands to run (click, type, press keys, etc).
   */
  private async executeSmartAction(page: Page, action: PlannedAction): Promise<void> {
    const desc = action.description;
    const descLower = desc.toLowerCase();

    // Try CSS selector for precise targeting
    const target = action.selector
      ? await page.$(action.selector).catch(() => null)
      : null;

    // Detect typing: "type 'text'", "enter 'text'", "example 'text'"
    const typeMatch = desc.match(/type[^'"]*['"]([^'"]+)['"]/i)
      ?? desc.match(/enter[^'"]*['"]([^'"]+)['"]/i)
      ?? desc.match(/example\s+['"]([^'"]+)['"]/i)
      ?? desc.match(/for example\s+['"]([^'"]+)['"]/i);

    // Detect keyboard press: "press Enter", "press Tab"
    const pressMatch = desc.match(/press\s+(?:the\s+)?(\w+)\s+key/i)
      ?? desc.match(/press\s+(\w+)/i);

    // Click/focus action
    if (descLower.includes("click") || descLower.includes("focus")) {
      if (target) {
        await target.scrollIntoViewIfNeeded();
        const box = await target.boundingBox();
        if (box) {
          await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 15 });
          await page.waitForTimeout(200);
          await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
        }
      } else {
        await page.mouse.move(action.x, action.y, { steps: 15 });
        await page.waitForTimeout(200);
        await page.mouse.click(action.x, action.y);
      }
    }

    // Type text if detected
    if (typeMatch) {
      await page.waitForTimeout(300);
      await page.keyboard.type(typeMatch[1], { delay: TYPING_DELAY_MS });
      await page.waitForTimeout(500);
    }

    // Press key if detected (and not already typing)
    if (pressMatch && !typeMatch) {
      const keyMap: Record<string, string> = {
        enter: "Enter", tab: "Tab", escape: "Escape",
        backspace: "Backspace", delete: "Delete", space: "Space",
      };
      const mappedKey = keyMap[pressMatch[1].toLowerCase()] ?? pressMatch[1];
      await page.waitForTimeout(300);
      await page.keyboard.press(mappedKey);
      await page.waitForTimeout(500);
    }

    // Fallback: click at coordinates if no specific action detected
    if (!descLower.includes("click") && !descLower.includes("focus")
        && !typeMatch && !pressMatch) {
      await page.mouse.move(action.x, action.y, { steps: 15 });
      await page.waitForTimeout(200);
      await page.mouse.click(action.x, action.y);
    }
  }

  /** Stagehand natural-language fallback for low-confidence actions */
  private async executeStagehandFallback(page: Page, action: PlannedAction): Promise<void> {
    console.log(`[SceneRecorder] Using Stagehand fallback for: "${action.description}"`);
    try {
      const { Stagehand } = await import("@browserbasehq/stagehand");
      const stagehand = new Stagehand({ env: "LOCAL", verbose: 0, enableCaching: false });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await stagehand.init({ modelName: "claude-sonnet-4-6" as any });
      await stagehand.page.act(action.description);
      await stagehand.close();
    } catch (err) {
      console.warn(`[SceneRecorder] Stagehand unavailable, using smart action: ${(err as Error).message}`);
      await this.executeSmartAction(page, action);
    }
  }

  /** Wait for page stability after action */
  private async waitForStability(page: Page, action: PlannedAction): Promise<void> {
    if (action.waitFor === "networkidle") {
      await page.waitForLoadState("networkidle").catch(() => undefined);
    } else if (action.waitFor === "domcontentloaded") {
      await page.waitForLoadState("domcontentloaded").catch(() => undefined);
    } else if (action.waitFor === "load") {
      await page.waitForLoadState("load").catch(() => undefined);
    }

    if (action.waitMs && action.waitMs > 0) {
      await page.waitForTimeout(action.waitMs);
    }
  }
}
