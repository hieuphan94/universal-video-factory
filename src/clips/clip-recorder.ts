// Clip recorder — records a single atomic browser action as a reusable video clip.
// Uses shared action-executor for Playwright action execution.

import * as fs from "fs/promises";
import * as path from "path";
import { chromium } from "playwright";
import { executeMultiStepAction, waitForStability, resolveClickTarget } from "../capture/action-executor.js";
import { convertWebmToMp4 } from "../export/ffmpeg-exporter.js";
import { createLogger } from "../utils/logger.js";

const log = createLogger("clip-recorder");

const POST_ACTION_BUFFER_MS = 2000;

export interface ClipRecordingOptions {
  url: string;
  action: string;
  viewportWidth?: number;
  viewportHeight?: number;
  fps?: number;
  headless?: boolean;
  pageLoadTimeoutMs?: number;
  actionTimeoutMs?: number;
}

export interface ClipRecordingResult {
  videoPath: string;
  thumbnailPath: string;
  durationMs: number;
  clickX: number;
  clickY: number;
}

/**
 * Record a single action clip from a URL.
 * Steps: launch browser → navigate → screenshot (thumbnail) → execute action → stop recording → convert to mp4
 */
export async function recordClip(
  opts: ClipRecordingOptions,
  outputDir: string
): Promise<ClipRecordingResult> {
  const width = opts.viewportWidth ?? 1920;
  const height = opts.viewportHeight ?? 1080;
  const headless = opts.headless ?? true;
  const pageLoadTimeout = opts.pageLoadTimeoutMs ?? 30000;
  const actionTimeout = opts.actionTimeoutMs ?? 10000;

  await fs.mkdir(outputDir, { recursive: true });
  const videoDir = path.join(outputDir, "raw-recording");
  await fs.mkdir(videoDir, { recursive: true });

  const browser = await chromium.launch({ headless });
  const context = await browser.newContext({
    viewport: { width, height },
    recordVideo: { dir: videoDir, size: { width, height } },
  });

  const page = await context.newPage();
  page.setDefaultTimeout(actionTimeout);
  page.setDefaultNavigationTimeout(pageLoadTimeout);

  let clickX = width / 2;
  let clickY = height / 2;
  const startTime = Date.now();

  try {
    // Navigate to URL
    log.info(`Navigating to ${opts.url}`);
    await page.goto(opts.url, { waitUntil: "domcontentloaded", timeout: pageLoadTimeout });
    await page.waitForTimeout(1000);

    // Take thumbnail before action
    const thumbPath = path.join(outputDir, "thumb.png");
    await page.screenshot({ path: thumbPath });

    // Resolve click target to get coordinates
    const actionTarget = {
      x: width / 2,
      y: height / 2,
      description: opts.action,
    };
    const resolved = await resolveClickTarget(page, actionTarget);
    if (resolved) {
      clickX = resolved.x;
      clickY = resolved.y;
      actionTarget.x = resolved.x;
      actionTarget.y = resolved.y;
    }

    // Execute the action (supports multi-step via "then" splitting)
    log.info(`Executing: ${opts.action}`);
    await executeMultiStepAction(page, actionTarget, 2);
    await waitForStability(page, actionTarget);

    // Post-action buffer to show the result
    await page.waitForTimeout(POST_ACTION_BUFFER_MS);
  } finally {
    await page.close();
    await context.close();
    await browser.close();
  }

  const durationMs = Date.now() - startTime;

  // Find and convert the recorded webm to mp4
  const rawFiles = await fs.readdir(videoDir);
  const webmFile = rawFiles.find((f) => f.endsWith(".webm"));
  if (!webmFile) {
    throw new Error("No recording file produced by Playwright");
  }

  const webmPath = path.join(videoDir, webmFile);
  const mp4Path = path.join(outputDir, "clip.mp4");
  log.info("Converting webm → mp4");
  await convertWebmToMp4(webmPath, mp4Path);

  // Cleanup raw recording dir
  await fs.rm(videoDir, { recursive: true, force: true });

  log.info(`Clip recorded: ${mp4Path} (${(durationMs / 1000).toFixed(1)}s)`);

  return {
    videoPath: mp4Path,
    thumbnailPath: path.join(outputDir, "thumb.png"),
    durationMs,
    clickX: Math.round(clickX),
    clickY: Math.round(clickY),
  };
}
