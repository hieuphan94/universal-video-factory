import * as path from "path";
import * as fs from "fs";
import { bundle } from "@remotion/bundler";
import { renderMedia, selectComposition } from "@remotion/renderer";
import { mapProjectToRenderProps } from "./scene-timing-mapper.js";
import type { RenderOptions, RenderResult } from "./types.js";

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
    concurrency = 4,
    onProgress,
  } = options;

  const startMs = Date.now();

  console.log(`[render-engine] Bundling Remotion composition...`);
  const bundled = await bundle({
    entryPoint: REMOTION_ROOT,
    // Silence webpack progress spam during render
    onProgress: () => undefined,
  });

  // Copy audio and video assets into the bundle so Remotion's server can serve them
  const absoluteProjectDir = path.resolve(projectDir);
  copyAssetsToBundle(absoluteProjectDir, bundled);

  console.log(`[render-engine] Loading input props from ${projectDir}`);
  const inputProps = mapProjectToRenderProps(projectDir);

  console.log(`[render-engine] Selecting composition: ${COMPOSITION_ID}`);
  // Cast to satisfy @remotion/renderer's Record<string,unknown> constraint
  const props = inputProps as unknown as Record<string, unknown>;

  const composition = await selectComposition({
    serveUrl: bundled,
    id: COMPOSITION_ID,
    inputProps: props,
  });

  console.log(
    `[render-engine] Rendering ${composition.durationInFrames} frames at ${composition.fps}fps`
  );

  await renderMedia({
    composition,
    serveUrl: bundled,
    codec,
    outputLocation: outputPath,
    inputProps: props,
    concurrency,
    onProgress: ({ progress }: { progress: number }) => {
      const pct = Math.round(progress * 100);
      onProgress?.(pct);
      process.stdout.write(`\r[render-engine] Progress: ${pct}%`);
    },
  });

  process.stdout.write("\n");

  const durationMs = Date.now() - startMs;
  console.log(`[render-engine] Done in ${(durationMs / 1000).toFixed(1)}s → ${outputPath}`);

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
  const { projectDir, outputPath, inputProps, codec = "h264", concurrency = 4, onProgress } = options;
  const startMs = Date.now();

  console.log(`[render-engine] Bundling Remotion composition...`);
  const bundled = await bundle({ entryPoint: REMOTION_ROOT, onProgress: () => undefined });

  const absoluteProjectDir = path.resolve(projectDir);
  copyAssetsToBundle(absoluteProjectDir, bundled);

  const composition = await selectComposition({
    serveUrl: bundled,
    id: COMPOSITION_ID,
    inputProps,
  });

  console.log(`[render-engine] Rendering ${composition.durationInFrames} frames at ${composition.fps}fps`);

  await renderMedia({
    composition,
    serveUrl: bundled,
    codec,
    outputLocation: outputPath,
    inputProps,
    concurrency,
    onProgress: ({ progress }: { progress: number }) => {
      const pct = Math.round(progress * 100);
      onProgress?.(pct);
      process.stdout.write(`\r[render-engine] Progress: ${pct}%`);
    },
  });

  process.stdout.write("\n");
  const durationMs = Date.now() - startMs;
  console.log(`[render-engine] Done in ${(durationMs / 1000).toFixed(1)}s → ${outputPath}`);

  return { outputPath, durationMs, framesRendered: composition.durationInFrames };
}

/**
 * Copy audio/ and scenes/ directories from the project output into the
 * Remotion webpack bundle directory so they're accessible via the dev server.
 */
function copyAssetsToBundle(projectDir: string, bundleDir: string): void {
  const dirs = ["audio", "scenes"];
  for (const dir of dirs) {
    const src = path.join(projectDir, dir);
    const dest = path.join(bundleDir, dir);
    if (fs.existsSync(src)) {
      fs.cpSync(src, dest, { recursive: true });
    }
  }
  console.log(`[render-engine] Copied assets to bundle`);
}
