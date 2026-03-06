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
import type { SceneDuration } from "../voice/voice-pipeline.js";

// Delay after typing each character for natural typing appearance
const TYPING_DELAY_MS = 100;
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

        console.log(
          `[SceneRecorder] Scene ${action.sceneIndex}: ${action.description} ` +
          `(target: ${(narrationMs / 1000).toFixed(1)}s)`
        );
        const sceneStart = Date.now();

        try {
          // Execute the action (click, type, press key, etc)
          await this.executeAction(page, action);
          await this.waitForStability(page, action);

          // Calculate remaining time: scene should last at least narrationMs
          const actionElapsed = Date.now() - sceneStart;
          const targetMs = Math.max(narrationMs, actionElapsed + POST_ACTION_BUFFER_MS);
          const remainingMs = targetMs - actionElapsed;

          if (remainingMs > 0) {
            await page.waitForTimeout(remainingMs);
          }

          const durationMs = Date.now() - sceneStart;
          console.log(`[SceneRecorder] Scene ${String(action.sceneIndex).padStart(2, "0")} recorded (${(durationMs / 1000).toFixed(1)}s)`);
          results.push({
            sceneIndex: action.sceneIndex,
            videoPath: "",
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
    console.log(`[SceneRecorder] All ${results.length} scene(s) recorded in ${(totalMs / 1000).toFixed(1)}s`);

    return results;
  }

  /** Execute action — parses description for click, type, and keyboard actions */
  private async executeAction(page: Page, action: PlannedAction): Promise<void> {
    const desc = action.description.toLowerCase();
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

    const typeMatch = desc.match(/type[^'"]*['"]([^'"]+)['"]/i)
      ?? desc.match(/enter[^'"]*['"]([^'"]+)['"]/i)
      ?? desc.match(/example\s+['"]([^'"]+)['"]/i)
      ?? desc.match(/for example\s+['"]([^'"]+)['"]/i);

    const pressMatch = desc.match(/press\s+(?:the\s+)?(\w+)\s+key/i)
      ?? desc.match(/press\s+(\w+)/i);

    if (descLower.includes("click") || descLower.includes("focus")) {
      // Try to find the right element: first by smart locator from description,
      // then by provided selector, then fallback to coordinates
      const clickTarget = await this.resolveClickTarget(page, action);
      if (clickTarget) {
        await page.mouse.move(clickTarget.x, clickTarget.y, { steps: 15 });
        await page.waitForTimeout(200);
        await page.mouse.click(clickTarget.x, clickTarget.y);
      } else {
        await page.mouse.move(action.x, action.y, { steps: 15 });
        await page.waitForTimeout(200);
        await page.mouse.click(action.x, action.y);
      }
    }

    if (typeMatch) {
      await page.waitForTimeout(300);
      await page.keyboard.type(typeMatch[1], { delay: TYPING_DELAY_MS });
      await page.waitForTimeout(500);
    }

    if (pressMatch) {
      const keyMap: Record<string, string> = {
        enter: "Enter", tab: "Tab", escape: "Escape",
        backspace: "Backspace", delete: "Delete", space: "Space",
      };
      const mappedKey = keyMap[pressMatch[1].toLowerCase()] ?? pressMatch[1];
      await page.waitForTimeout(300);
      await page.keyboard.press(mappedKey);
      await page.waitForTimeout(500);
    }

    if (!descLower.includes("click") && !descLower.includes("focus")
        && !typeMatch && !pressMatch) {
      await page.mouse.move(action.x, action.y, { steps: 15 });
      await page.waitForTimeout(200);
      await page.mouse.click(action.x, action.y);
    }
  }

  /**
   * Resolve the best click target by parsing the action description for context clues.
   * Uses Playwright locators (role, text, label) to find elements that didn't exist
   * at initial screenshot time (e.g., checkboxes created after adding todo items).
   * Falls back to the provided selector if no smart match is found.
   */
  private async resolveClickTarget(
    page: Page,
    action: PlannedAction
  ): Promise<{ x: number; y: number } | null> {
    const desc = action.description.toLowerCase();

    // Extract text context from description (e.g., "next to 'Buy groceries'" or "for 'Buy groceries'")
    const textContext = action.description.match(
      /(?:next to|for|of|labeled?|named?)\s+['"]([^'"]+)['"]/i
    );
    const contextText = textContext?.[1];

    // Try smart locator strategies based on description keywords
    const locator = await this.findSmartLocator(page, desc, contextText);
    if (locator) {
      const box = await locator.boundingBox().catch(() => null);
      if (box) {
        return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
      }
    }

    // Fallback: use the provided selector
    if (action.selector) {
      const el = await page.$(action.selector).catch(() => null);
      if (el) {
        await el.scrollIntoViewIfNeeded();
        const box = await el.boundingBox();
        if (box) {
          return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
        }
      }
    }

    return null;
  }

  /**
   * Find an element using Playwright's semantic locators based on description keywords.
   * Handles checkboxes, buttons, links, and other interactive elements.
   */
  private async findSmartLocator(
    page: Page,
    desc: string,
    contextText?: string
  ): Promise<import("playwright").Locator | null> {
    try {
      // Checkbox: find by role near context text
      if (desc.includes("checkbox") || desc.includes("check") || desc.includes("toggle") || desc.includes("complete") || desc.includes("mark")) {
        if (contextText) {
          // Find the list item containing the text, then its checkbox
          const item = page.locator(`text="${contextText}"`).first();
          if (await item.isVisible().catch(() => false)) {
            const checkbox = item.locator("..").locator('input[type="checkbox"]').first();
            if (await checkbox.isVisible().catch(() => false)) return checkbox;
            // Try sibling/parent checkbox via role
            const roleCheckbox = item.locator("..").getByRole("checkbox").first();
            if (await roleCheckbox.isVisible().catch(() => false)) return roleCheckbox;
          }
          // Broader: any checkbox in the same parent container as the text
          const container = page.locator(`:has(> :text("${contextText}")) input[type="checkbox"]`).first();
          if (await container.isVisible().catch(() => false)) return container;
        }
        // No context: first visible checkbox
        const anyCheckbox = page.getByRole("checkbox").first();
        if (await anyCheckbox.isVisible().catch(() => false)) return anyCheckbox;
      }

      // Button: find by text or role
      if (desc.includes("button")) {
        const btnTextMatch = desc.match(/['"]([^'"]+)['"]/);
        if (btnTextMatch) {
          const btn = page.getByRole("button", { name: btnTextMatch[1] }).first();
          if (await btn.isVisible().catch(() => false)) return btn;
        }
      }

      // Link: find by text
      if (desc.includes("link") || desc.includes("click on")) {
        const linkTextMatch = desc.match(/['"]([^'"]+)['"]/);
        if (linkTextMatch) {
          const link = page.getByRole("link", { name: linkTextMatch[1] }).first();
          if (await link.isVisible().catch(() => false)) return link;
        }
      }
    } catch {
      // Locator strategies are best-effort
    }

    return null;
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
