// Human screen recorder — Playwright browser with script overlay, cursor tracking, video recording
// Human follows script steps, tool captures video + events. Press Esc to stop.

import * as fs from "fs";
import * as path from "path";
import { chromium } from "playwright";
import { convertWebmToMp4 } from "../export/ffmpeg-exporter.js";
import { injectEventTrackers, flushEvents, reinjectAfterNavigation } from "./event-tracker.js";
import { injectScriptOverlay, isRecordingDone, getSceneMarks, getCurrentStep } from "./script-overlay-injector.js";
import * as readline from "readline";
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
  /** Actual TTS durations per scene (seconds) — used for typewriter pacing */
  sceneDurationsSec?: number[];
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

  // Save script steps as readable text file + print to terminal
  const stepsText = opts.script.steps
    .map((s) => `${s.step}. ${s.instruction}  (~${s.expectedDurationSec}s)\n   🎙 "${s.narration}"`)
    .join("\n\n");
  const stepsFilePath = path.join(opts.outputDir, "script-steps.txt");
  fs.writeFileSync(stepsFilePath, `${opts.script.title}\n${"─".repeat(55)}\n${stepsText}\n`, "utf-8");
  log.info(`Script saved → ${stepsFilePath}`);

  log.info("─".repeat(55));
  log.info("SCRIPT — read through, then perform in order:");
  log.info("─".repeat(55));
  for (const step of opts.script.steps) {
    log.info(`  ${step.step}. ${step.instruction}  (~${step.expectedDurationSec}s)`);
    log.info(`     🎙 "${step.narration}"`);
  }
  log.info("─".repeat(55));
  log.info("Press Esc in browser when done. ` (backtick) = mark step boundary.");
  log.info("");

  // Wait for user to be ready
  await new Promise<void>((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stderr });
    rl.question("Press Enter when ready to start recording... ", () => {
      rl.close();
      resolve();
    });
  });

  log.info(`Launching browser (${width}x${height})`);

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

    // Inject event trackers + invisible keyboard listener (no visible overlay)
    await injectEventTrackers(page);
    await injectScriptOverlay(page, opts.script);

    // Re-inject trackers after navigation
    page.on("load", async () => {
      await reinjectAfterNavigation(page);
      try {
        await injectScriptOverlay(page, opts.script);
      } catch { /* page may be transitioning */ }
    });

    // Live terminal display during recording — redraws for typewriter narration
    let lastStep = 0;
    let stepStartTime = Date.now();
    let lastRevealCount = -1;

    // Switch to alternate screen for clean live display
    const recordingStartTime = Date.now();
    enterAltScreen();
    const sceneDurs = opts.sceneDurationsSec;
    printStepDisplay(opts.script, 0, 0, false, 0, sceneDurs);

    while (true) {
      await page.waitForTimeout(POLL_INTERVAL_MS);

      // Flush events from page
      const batch = await flushEvents(page);
      allEvents.push(...batch);

      const totalElapsed = Math.round((Date.now() - recordingStartTime) / 1000);

      // Check step advancement via backtick key
      const currentStep = await getCurrentStep(page);
      const justAdvanced = currentStep > lastStep;
      if (justAdvanced) {
        lastStep = currentStep;
        stepStartTime = Date.now();
        lastRevealCount = -1;
        printStepDisplay(opts.script, lastStep, 0, true, totalElapsed, sceneDurs);
      }

      // Redraw when typewriter reveals a new character or timer second changes
      const elapsedMs = Date.now() - stepStartTime;
      const elapsedSec = elapsedMs / 1000;
      const step = lastStep < opts.script.steps.length ? opts.script.steps[lastStep] : null;
      const narLen = step?.narration.length ?? 0;
      // Use actual TTS duration when available, fallback to expectedDurationSec
      const duration = sceneDurs?.[lastStep] ?? step?.expectedDurationSec ?? 5;
      const currentReveal = Math.min(narLen, Math.floor((narLen / duration) * elapsedSec));

      if (!justAdvanced && currentReveal !== lastRevealCount) {
        lastRevealCount = currentReveal;
        printStepDisplay(opts.script, lastStep, elapsedSec, false, totalElapsed, sceneDurs);
      }

      // Check if human pressed Esc
      if (await isRecordingDone(page)) {
        leaveAltScreen();
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

/** Enter alternate screen buffer for clean live display */
function enterAltScreen(): void {
  process.stderr.write("\x1b[?1049h\x1b[H");
}

/** Leave alternate screen buffer, restoring previous terminal content */
function leaveAltScreen(): void {
  process.stderr.write("\x1b[?1049l");
}

/** Render live step display on alternate screen — cursor reset to top each time */
function printStepDisplay(
  script: TutorialScript,
  stepIdx: number,
  elapsedSec: number,  // fractional seconds for typewriter precision
  justAdvanced: boolean,
  totalElapsedSec?: number,
  sceneDurationsSec?: number[],
): void {
  const steps = script.steps;
  const total = steps.length;

  // Move cursor to top-left, then write content
  let out = "\x1b[H\x1b[J"; // cursor home + clear from cursor to end

  out += "══════════════════════════════════════════════════════\n";

  if (justAdvanced && stepIdx > 0 && stepIdx <= total) {
    const doneName = steps[stepIdx - 1]?.instruction ?? "";
    out += `  \x1b[42m\x1b[30m\x1b[1m ✓ STEP ${stepIdx}/${total} DONE \x1b[0m ${doneName}\n`;
  } else {
    out += "              🎬 RECORDING IN PROGRESS\n";
  }

  out += "══════════════════════════════════════════════════════\n\n";

  if (stepIdx >= total) {
    out += `  \x1b[38;5;114m\x1b[1m✓ All ${total} steps complete!\x1b[0m\n\n`;
    out += "  Press \x1b[1mEsc\x1b[0m in browser to stop recording.\n";
  } else {
    const step = steps[stepIdx]!;
    const totalStr = totalElapsedSec != null ? `  \x1b[2mTotal: ${totalElapsedSec}s\x1b[0m` : "";

    out += `  \x1b[38;5;75m\x1b[1mStep ${stepIdx + 1} / ${total}\x1b[0m  \x1b[33m${Math.round(elapsedSec)}s\x1b[0m${totalStr}\n\n`;
    out += `  \x1b[1m→ ${step.instruction}\x1b[0m\n\n`;

    // Typewriter narration — reveals text at actual TTS speaking speed
    const narration = step.narration;
    const duration = sceneDurationsSec?.[stepIdx] ?? step.expectedDurationSec ?? 5;
    const charsPerSec = narration.length / duration;
    const revealCount = Math.min(narration.length, Math.floor(charsPerSec * elapsedSec));
    const revealed = narration.slice(0, revealCount);
    const hidden = narration.slice(revealCount);
    out += `  \x1b[38;5;222m🎙 "${revealed}\x1b[38;5;238m${hidden}\x1b[38;5;222m"\x1b[0m\n\n`;

    const next = stepIdx + 1 < total ? steps[stepIdx + 1] : null;
    if (next) {
      out += `  \x1b[2mNext: ${next.instruction}\x1b[0m\n`;
    }
  }

  out += "\n──────────────────────────────────────────────────────\n";
  out += "  \x1b[1m[`]\x1b[0m next step    \x1b[1m[Esc]\x1b[0m stop recording\n";
  out += "──────────────────────────────────────────────────────\n";

  process.stderr.write(out);
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
