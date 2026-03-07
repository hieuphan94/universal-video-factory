// FFmpeg exporter — webm→mp4 conversion + HEVC VideoToolbox final export

import { spawn } from "child_process";
import * as fs from "fs/promises";
import type { ExportOptions, ExportResult, ConvertResult } from "./types.js";
import { createLogger } from "../utils/logger.js";

const log = createLogger("ffmpeg");

// --- FFmpeg availability check ---

let ffmpegChecked = false;

async function ensureFfmpeg(): Promise<void> {
  if (ffmpegChecked) return;
  await new Promise<void>((resolve, reject) => {
    const proc = spawn("ffmpeg", ["-version"], { stdio: "ignore" });
    proc.on("close", (code) => {
      if (code === 0) { ffmpegChecked = true; resolve(); }
      else reject(new Error("ffmpeg not found. Install via: brew install ffmpeg"));
    });
    proc.on("error", () =>
      reject(new Error("ffmpeg not found. Install via: brew install ffmpeg"))
    );
  });
}

// --- Shared FFmpeg runner ---

function runFfmpeg(args: string[], onProgress?: (frame: number) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn("ffmpeg", args, { stdio: ["ignore", "ignore", "pipe"] });

    let stderr = "";
    proc.stderr?.on("data", (chunk: Buffer) => {
      const text = chunk.toString();
      stderr += text;

      if (onProgress) {
        // Parse "frame=  1234" from FFmpeg progress output
        const match = text.match(/frame=\s*(\d+)/);
        if (match) onProgress(parseInt(match[1], 10));
      }
    });

    proc.on("close", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`ffmpeg exited with code ${code}.\nstderr: ${stderr.slice(-800)}`));
      }
    });

    proc.on("error", (err) => reject(new Error(`Failed to spawn ffmpeg: ${err.message}`)));
  });
}

// --- Public API ---

/**
 * Convert a Playwright-recorded .webm to .mp4 (H.264) for Remotion ingestion.
 *
 * Uses: ffmpeg -i input.webm -c:v libx264 -crf 18 -preset fast output.mp4
 * No shell string interpolation — args array only.
 */
export async function convertWebmToMp4(
  inputPath: string,
  outputPath: string
): Promise<ConvertResult> {
  await ensureFfmpeg();
  const startMs = Date.now();

  log.info(`Converting webm → mp4: ${inputPath}`);

  const args = [
    "-y",               // overwrite without prompt
    "-i", inputPath,
    "-c:v", "libx264",
    "-crf", "18",
    "-preset", "fast",
    "-c:a", "aac",
    "-b:a", "128k",
    outputPath,
  ];

  await runFfmpeg(args);

  // Verify output exists and has content
  const stat = await fs.stat(outputPath);
  if (stat.size === 0) throw new Error(`Converted file is empty: ${outputPath}`);

  const durationMs = Date.now() - startMs;
  log.info(`Conversion done in ${(durationMs / 1000).toFixed(1)}s → ${outputPath}`);

  return { outputPath, durationMs };
}

/**
 * Re-encode Remotion draft MP4 to HEVC using VideoToolbox (Metal-accelerated on Apple Silicon).
 * Falls back to libx265 if hevc_videotoolbox is unavailable.
 *
 * Target: HEVC/H.265, AAC 192kbps, 1920x1080, 30fps, faststart.
 */
export async function exportFinalVideo(
  draftPath: string,
  outputPath: string,
  options: ExportOptions = {}
): Promise<ExportResult> {
  await ensureFfmpeg();

  const {
    videoBitrate = "8M",
    audioBitrate = "192k",
    onProgress,
  } = options;

  const startMs = Date.now();

  // Try hardware-accelerated HEVC first
  const hwArgs = buildHevcArgs(draftPath, outputPath, videoBitrate, audioBitrate, "hevc_videotoolbox");

  try {
    log.info("Encoding with hevc_videotoolbox (Metal)...");
    await runFfmpeg(hwArgs, onProgress);

    const stat = await fs.stat(outputPath);
    if (stat.size === 0) throw new Error("Output file is empty after hw encode");

    const durationMs = Date.now() - startMs;
    log.info(`HEVC export done in ${(durationMs / 1000).toFixed(1)}s → ${outputPath}`);
    return { outputPath, durationMs, encoder: "hevc_videotoolbox" };

  } catch (hwErr) {
    log.warn(`hevc_videotoolbox failed (${(hwErr as Error).message.split("\n")[0]}), falling back to libx265...`);
  }

  // Fallback: software libx265
  const swArgs = buildHevcArgs(draftPath, outputPath, videoBitrate, audioBitrate, "libx265");
  log.info("Encoding with libx265 (software)...");
  await runFfmpeg(swArgs, onProgress);

  const stat = await fs.stat(outputPath);
  if (stat.size === 0) throw new Error("Output file is empty after sw encode");

  const durationMs = Date.now() - startMs;
  log.info(`libx265 export done in ${(durationMs / 1000).toFixed(1)}s → ${outputPath}`);
  return { outputPath, durationMs, encoder: "libx265" };
}

// --- Helpers ---

export function buildHevcArgs(
  input: string,
  output: string,
  videoBitrate: string,
  audioBitrate: string,
  encoder: "hevc_videotoolbox" | "libx265"
): string[] {
  const args = [
    "-y",
    "-i", input,
    "-c:v", encoder,
    "-b:v", videoBitrate,
    "-c:a", "aac",
    "-b:a", audioBitrate,
    "-movflags", "+faststart",
  ];

  // hvc1 tag required for Apple/QuickTime compatibility with VideoToolbox output
  if (encoder === "hevc_videotoolbox") {
    args.push("-tag:v", "hvc1");
  }

  args.push(output);
  return args;
}
