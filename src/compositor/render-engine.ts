import * as path from "path";
import * as os from "os";
import * as fs from "fs";
import { bundle } from "@remotion/bundler";
import { renderMedia, selectComposition } from "@remotion/renderer";
import { mapProjectToRenderProps } from "./scene-timing-mapper.js";
import type { RenderOptions, RenderResult } from "./types.js";
import { createLogger } from "../utils/logger.js";

const log = createLogger("render-engine");

/** Below this → concurrency=1. Below CRITICAL → abort render. */
const LOW_RAM_MB = 2048;
const CRITICAL_RAM_MB = 512;

/** Get safe concurrency based on available system memory */
function safeConcurrency(requested: number): number {
  const freeMB = Math.round(os.freemem() / 1024 / 1024);
  if (freeMB < CRITICAL_RAM_MB) {
    throw new Error(
      `Cannot render: only ${freeMB}MB RAM free (need >${CRITICAL_RAM_MB}MB). Close other apps and retry.`
    );
  }
  if (freeMB < LOW_RAM_MB) {
    log.warn(`Low RAM: ${freeMB}MB free. Forcing concurrency=1 to prevent freeze.`);
    return 1;
  }
  log.info(`Available RAM: ${freeMB}MB — using concurrency=${requested}`);
  return requested;
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

  const actualConcurrency = safeConcurrency(concurrency);
  log.info(`Rendering ${composition.durationInFrames} frames at ${composition.fps}fps`);

  await renderMedia({
    composition,
    serveUrl: bundled,
    codec,
    outputLocation: outputPath,
    inputProps: props,
    concurrency: actualConcurrency,
    onProgress: ({ progress }: { progress: number }) => {
      const pct = Math.round(progress * 100);
      onProgress?.(pct);
      process.stdout.write(`\r[render-engine] Progress: ${pct}%`);
    },
  });

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

  const actualConcurrency = safeConcurrency(concurrency);
  log.info(`Rendering ${composition.durationInFrames} frames at ${composition.fps}fps`);

  await renderMedia({
    composition,
    serveUrl: bundled,
    codec,
    outputLocation: outputPath,
    inputProps,
    concurrency: actualConcurrency,
    onProgress: ({ progress }: { progress: number }) => {
      const pct = Math.round(progress * 100);
      onProgress?.(pct);
      process.stdout.write(`\r[render-engine] Progress: ${pct}%`);
    },
  });

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
