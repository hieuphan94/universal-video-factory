// Human screen recorder — Playwright browser with script overlay, cursor tracking, video recording
// Human follows script steps, tool captures video + events. Press Esc to stop.

import * as fs from "fs";
import * as path from "path";
import { chromium } from "playwright";
import { convertWebmToMp4 } from "../export/ffmpeg-exporter.js";
import { injectEventTrackers, flushEvents, reinjectAfterNavigation } from "./event-tracker.js";
import { injectScriptOverlay, isRecordingDone, getSceneMarks } from "./script-overlay-injector.js";
import type { TutorialScript } from "../script/script-types.js";
import type { RecordingSession, RecordingResult, CursorEvent, SceneMarker } from "./recorder-types.js";
import { createLogger } from "../utils/logger.js";

const log = createLogger("recorder");

const EVENT_FLUSH_INTERVAL_MS = 2000;
const POLL_INTERVAL_MS = 500;

export interface HumanRecorderOptions {
  script: TutorialScript;
  url: string;
  outputDir: string;
  viewportWidth?: number;
  viewportHeight?: number;
}

/**
 * Launch browser for human-controlled recording.
 * Shows script overlay, tracks cursor/clicks, records video.
 * Returns when human presses Esc.
 */
export async function recordHumanSession(opts: HumanRecorderOptions): Promise<RecordingResult> {
  const width = opts.viewportWidth ?? 1920;
  const height = opts.viewportHeight ?? 1080;

  fs.mkdirSync(opts.outputDir, { recursive: true });
  const videoDir = path.join(opts.outputDir, "raw-recording");
  fs.mkdirSync(videoDir, { recursive: true });

  log.info(`Launching browser (${width}x${height})`);
  log.info("Follow the script overlay. Press Space=next step, Esc=stop.");

  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext({
    viewport: { width, height },
    recordVideo: { dir: videoDir, size: { width, height } },
  });

  const page = await context.newPage();
  page.setDefaultNavigationTimeout(30000);

  const allEvents: CursorEvent[] = [];
  const startTime = Date.now();

  try {
    // Navigate to URL
    log.info(`Navigating to ${opts.url}`);
    await page.goto(opts.url, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1000);

    // Take thumbnail
    const thumbPath = path.join(opts.outputDir, "thumb.png");
    await page.screenshot({ path: thumbPath });

    // Inject event trackers + script overlay
    await injectEventTrackers(page);
    await injectScriptOverlay(page, opts.script);

    // Re-inject trackers after navigation
    page.on("load", async () => {
      await reinjectAfterNavigation(page);
      // Re-inject overlay after navigation (it gets lost)
      try {
        await injectScriptOverlay(page, opts.script);
      } catch { /* page may be transitioning */ }
    });

    // Periodic event flush + done check loop
    log.info("Recording started. Perform the tutorial steps...");
    while (true) {
      await page.waitForTimeout(POLL_INTERVAL_MS);

      // Flush events from page
      const batch = await flushEvents(page);
      allEvents.push(...batch);

      // Check if human pressed Esc
      if (await isRecordingDone(page)) {
        log.info("Recording stopped by user.");
        break;
      }
    }

    // Final flush
    const finalBatch = await flushEvents(page);
    allEvents.push(...finalBatch);

  } finally {
    // Get scene marks before closing
    const rawMarks = await getSceneMarks(page);
    const durationMs = Date.now() - startTime;

    await page.close();
    await context.close();
    await browser.close();

    // Build scene markers from hotkey timestamps
    const scenes = buildSceneMarkers(rawMarks, durationMs);

    // Save events.json
    const session: RecordingSession = {
      recordedAt: new Date().toISOString(),
      url: opts.url,
      durationMs,
      viewport: { width, height },
      scenes,
      events: allEvents,
    };
    const eventsPath = path.join(opts.outputDir, "events.json");
    fs.writeFileSync(eventsPath, JSON.stringify(session, null, 2), "utf-8");
    log.info(`Saved ${allEvents.length} events, ${scenes.length} scenes → ${eventsPath}`);

    // Convert webm → mp4
    const rawFiles = fs.readdirSync(videoDir);
    const webmFile = rawFiles.find((f) => f.endsWith(".webm"));
    if (!webmFile) throw new Error("No recording file produced");

    const webmPath = path.join(videoDir, webmFile);
    const mp4Path = path.join(opts.outputDir, "recording.mp4");
    log.info("Converting webm → mp4");
    await convertWebmToMp4(webmPath, mp4Path);

    // Cleanup raw recording
    fs.rmSync(videoDir, { recursive: true, force: true });

    log.info(`Done: ${mp4Path} (${(durationMs / 1000).toFixed(1)}s)`);

    return {
      videoPath: mp4Path,
      eventsPath,
      thumbnailPath: path.join(opts.outputDir, "thumb.png"),
      durationMs,
      sceneCount: scenes.length,
    };
  }
}

/** Convert raw scene marks (step + ms) into SceneMarker array with start/end */
function buildSceneMarkers(
  marks: Array<{ step: number; ms: number }>,
  totalDurationMs: number
): SceneMarker[] {
  if (marks.length === 0) {
    return [{ step: 1, startMs: 0, endMs: totalDurationMs }];
  }

  // Sort by ms, deduplicate by step
  const sorted = [...marks].sort((a, b) => a.ms - b.ms);
  const unique = sorted.filter((m, i, arr) => i === 0 || m.step !== arr[i - 1].step);

  const scenes: SceneMarker[] = [];
  for (let i = 0; i < unique.length; i++) {
    const endMs = i + 1 < unique.length ? unique[i + 1].ms : totalDurationMs;
    scenes.push({
      step: unique[i].step,
      startMs: unique[i].ms,
      endMs,
    });
  }
  return scenes;
}
