import * as path from "path";
import * as os from "os";
import * as fs from "fs";
import * as readline from "readline";
import { bundle } from "@remotion/bundler";
import { renderMedia, selectComposition } from "@remotion/renderer";
import { mapProjectToRenderProps } from "./scene-timing-mapper.js";
import type { RenderOptions, RenderResult } from "./types.js";
import { createLogger } from "../utils/logger.js";

const log = createLogger("render-engine");

/** Below this → concurrency=1. Below CRITICAL → abort render. */
const LOW_RAM_MB = 2048;
const CRITICAL_RAM_MB = 512;
/** How often to check RAM during render (ms) */
const RAM_CHECK_INTERVAL_MS = 3000;

/** Prompt user for a choice via stdin (CLI-friendly) */
async function promptUser(message: string, choices: string[]): Promise<number> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stderr });
  const choiceText = choices.map((c, i) => `  ${i + 1}) ${c}`).join("\n");
  return new Promise((resolve) => {
    rl.question(`\n⚠️  ${message}\n${choiceText}\nChoice [1-${choices.length}]: `, (answer) => {
      rl.close();
      const idx = parseInt(answer, 10) - 1;
      resolve(idx >= 0 && idx < choices.length ? idx : 0);
    });
  });
}

/** Get safe concurrency based on available system memory. Prompts user when RAM is low. */
async function safeConcurrency(requested: number): Promise<number> {
  const freeMB = Math.round(os.freemem() / 1024 / 1024);

  if (freeMB < CRITICAL_RAM_MB) {
    const choice = await promptUser(
      `RAM critically low: ${freeMB}MB free (need >${CRITICAL_RAM_MB}MB).`,
      [
        "Wait (close other apps, then press Enter to re-check)",
        "Abort render",
      ]
    );
    if (choice === 1) {
      throw new Error("Render aborted by user: insufficient RAM.");
    }
    // User chose to wait — re-check
    return safeConcurrency(requested);
  }

  if (freeMB < LOW_RAM_MB) {
    const choice = await promptUser(
      `Low RAM: ${freeMB}MB free (recommended: ${LOW_RAM_MB}MB).`,
      [
        `Continue with concurrency=1 (slower but safe)`,
        "Wait (close other apps, then press Enter to re-check)",
        "Abort render",
      ]
    );
    if (choice === 2) {
      throw new Error("Render aborted by user: insufficient RAM.");
    }
    if (choice === 1) {
      return safeConcurrency(requested); // re-check after user frees RAM
    }
    log.warn(`Proceeding with concurrency=1 (${freeMB}MB free)`);
    return 1;
  }

  log.info(`Available RAM: ${freeMB}MB — using concurrency=${requested}`);
  return requested;
}

/**
 * Monitor RAM during render. If it drops below critical threshold,
 * call the cancel callback to abort before system freezes.
 * Returns a cleanup function to stop monitoring.
 */
function startRamMonitor(onCritical: () => void): () => void {
  const timer = setInterval(() => {
    const freeMB = Math.round(os.freemem() / 1024 / 1024);
    if (freeMB < CRITICAL_RAM_MB) {
      log.error(`CRITICAL: RAM dropped to ${freeMB}MB during render — aborting to prevent freeze!`);
      onCritical();
    }
  }, RAM_CHECK_INTERVAL_MS);
  return () => clearInterval(timer);
}

// Path to the Remotion entry point (index file for Root.tsx)
const REMOTION_ROOT = path.resolve(
  path.dirname(new URL(import.meta.url).pathname),
  "../../remotion/src/index.ts"
);

const COMPOSITION_ID = "UniversalTemplate";

/**
 * Renders the UniversalTemplate composition to MP4.
 * Uses @remotion/renderer renderMedia() API with H.264 codec by default.
 *
 * @param options - render configuration (projectDir, outputPath, etc.)
 * @returns RenderResult with output path and timing stats
 */
export async function renderVideo(options: RenderOptions): Promise<RenderResult> {
  const {
    projectDir,
    outputPath,
    codec = "h264",
    concurrency = 2,
    onProgress,
  } = options;

  const startMs = Date.now();

  log.info("Bundling Remotion composition...");
  const bundled = await bundle({
    entryPoint: REMOTION_ROOT,
    // Silence webpack progress spam during render
    onProgress: () => undefined,
  });

  // Copy audio and video assets into the bundle so Remotion's server can serve them
  const absoluteProjectDir = path.resolve(projectDir);
  copyAssetsToBundle(absoluteProjectDir, bundled);

  log.info(`Loading input props from ${projectDir}`);
  const inputProps = mapProjectToRenderProps(projectDir);

  log.info(`Selecting composition: ${COMPOSITION_ID}`);
  // Cast to satisfy @remotion/renderer's Record<string,unknown> constraint
  const props = inputProps as unknown as Record<string, unknown>;

  const composition = await selectComposition({
    serveUrl: bundled,
    id: COMPOSITION_ID,
    inputProps: props,
  });

  const actualConcurrency = await safeConcurrency(concurrency);
  log.info(`Rendering ${composition.durationInFrames} frames at ${composition.fps}fps`);

  // Monitor RAM during render — abort if critically low
  let abortController: AbortController | undefined;
  try {
    abortController = new AbortController();
  } catch { /* AbortController not available in older Node */ }

  const stopMonitor = startRamMonitor(() => abortController?.abort());

  try {
    await renderMedia({
      composition,
      serveUrl: bundled,
      codec,
      outputLocation: outputPath,
      inputProps: props,
      concurrency: actualConcurrency,
      cancelSignal: abortController?.signal,
      onProgress: ({ progress }: { progress: number }) => {
        const pct = Math.round(progress * 100);
        onProgress?.(pct);
        process.stdout.write(`\r[render-engine] Progress: ${pct}%`);
      },
    });
  } catch (err) {
    if (abortController?.signal.aborted) {
      throw new Error("Render aborted: RAM critically low. Close other apps and retry.");
    }
    throw err;
  } finally {
    stopMonitor();
  }

  process.stdout.write("\n");

  const durationMs = Date.now() - startMs;
  log.info(`Done in ${(durationMs / 1000).toFixed(1)}s → ${outputPath}`);

  return {
    outputPath,
    durationMs,
    framesRendered: composition.durationInFrames,
  };
}

/** Render with pre-built input props (used by tutorial pipeline with markers.json) */
export async function renderVideoWithProps(options: {
  projectDir: string;
  outputPath: string;
  inputProps: Record<string, unknown>;
  codec?: "h264" | "h265" | "vp8" | "vp9";
  concurrency?: number;
  onProgress?: (progress: number) => void;
}): Promise<RenderResult> {
  const { projectDir, outputPath, inputProps, codec = "h264", concurrency = 2, onProgress } = options;
  const startMs = Date.now();

  log.info("Bundling Remotion composition...");
  const bundled = await bundle({ entryPoint: REMOTION_ROOT, onProgress: () => undefined });

  const absoluteProjectDir = path.resolve(projectDir);
  copyAssetsToBundle(absoluteProjectDir, bundled);

  const composition = await selectComposition({
    serveUrl: bundled,
    id: COMPOSITION_ID,
    inputProps,
  });

  const actualConcurrency = await safeConcurrency(concurrency);
  log.info(`Rendering ${composition.durationInFrames} frames at ${composition.fps}fps`);

  let abortController: AbortController | undefined;
  try {
    abortController = new AbortController();
  } catch { /* older Node fallback */ }

  const stopMonitor = startRamMonitor(() => abortController?.abort());

  try {
    await renderMedia({
      composition,
      serveUrl: bundled,
      codec,
      outputLocation: outputPath,
      inputProps,
      concurrency: actualConcurrency,
      cancelSignal: abortController?.signal,
      onProgress: ({ progress }: { progress: number }) => {
        const pct = Math.round(progress * 100);
        onProgress?.(pct);
        process.stdout.write(`\r[render-engine] Progress: ${pct}%`);
      },
    });
  } catch (err) {
    if (abortController?.signal.aborted) {
      throw new Error("Render aborted: RAM critically low. Close other apps and retry.");
    }
    throw err;
  } finally {
    stopMonitor();
  }

  process.stdout.write("\n");
  const durationMs = Date.now() - startMs;
  log.info(`Done in ${(durationMs / 1000).toFixed(1)}s → ${outputPath}`);

  return { outputPath, durationMs, framesRendered: composition.durationInFrames };
}

/**
 * Copy audio/ and scenes/ directories from the project output into the
 * Remotion webpack bundle directory so they're accessible via the dev server.
 */
function copyAssetsToBundle(projectDir: string, bundleDir: string): void {
  // Copy subdirectories (audio/, scenes/)
  const dirs = ["audio", "scenes"];
  for (const dir of dirs) {
    const src = path.join(projectDir, dir);
    const dest = path.join(bundleDir, dir);
    if (fs.existsSync(src)) {
      fs.cpSync(src, dest, { recursive: true });
    }
  }
  // Copy media files from project root (recording.mp4, *.webm, *.mp3)
  const mediaExts = [".mp4", ".webm", ".mp3", ".wav"];
  const entries = fs.readdirSync(projectDir);
  for (const entry of entries) {
    if (mediaExts.some((ext) => entry.endsWith(ext))) {
      const src = path.join(projectDir, entry);
      const dest = path.join(bundleDir, entry);
      if (fs.statSync(src).isFile()) {
        fs.copyFileSync(src, dest);
      }
    }
  }
  log.info("Copied assets to bundle");
}
