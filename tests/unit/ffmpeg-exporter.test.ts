// Unit tests for src/export/ffmpeg-exporter.ts — buildHevcArgs pure function
// Tests arg construction without spawning ffmpeg.

import { describe, it, expect } from "vitest";
import { buildHevcArgs } from "../../src/export/ffmpeg-exporter.js";

describe("buildHevcArgs", () => {
  it("builds correct args for hevc_videotoolbox", () => {
    const args = buildHevcArgs("/in/draft.mp4", "/out/final.mp4", "8M", "192k", "hevc_videotoolbox");
    expect(args).toEqual([
      "-y",
      "-i", "/in/draft.mp4",
      "-c:v", "hevc_videotoolbox",
      "-b:v", "8M",
      "-c:a", "aac",
      "-b:a", "192k",
      "-movflags", "+faststart",
      "-tag:v", "hvc1",
      "/out/final.mp4",
    ]);
  });

  it("builds correct args for libx265 (no hvc1 tag)", () => {
    const args = buildHevcArgs("/in/draft.mp4", "/out/final.mp4", "8M", "192k", "libx265");
    expect(args).toEqual([
      "-y",
      "-i", "/in/draft.mp4",
      "-c:v", "libx265",
      "-b:v", "8M",
      "-c:a", "aac",
      "-b:a", "192k",
      "-movflags", "+faststart",
      "/out/final.mp4",
    ]);
  });

  it("does not include hvc1 tag for libx265", () => {
    const args = buildHevcArgs("/in.mp4", "/out.mp4", "4M", "128k", "libx265");
    expect(args).not.toContain("-tag:v");
    expect(args).not.toContain("hvc1");
  });

  it("includes hvc1 tag for hevc_videotoolbox", () => {
    const args = buildHevcArgs("/in.mp4", "/out.mp4", "4M", "128k", "hevc_videotoolbox");
    const tagIdx = args.indexOf("-tag:v");
    expect(tagIdx).toBeGreaterThan(-1);
    expect(args[tagIdx + 1]).toBe("hvc1");
  });

  it("uses custom bitrate values", () => {
    const args = buildHevcArgs("/in.mp4", "/out.mp4", "4M", "128k", "libx265");
    expect(args).toContain("4M");
    expect(args).toContain("128k");
  });

  it("always starts with -y for overwrite", () => {
    const args = buildHevcArgs("/in.mp4", "/out.mp4", "8M", "192k", "libx265");
    expect(args[0]).toBe("-y");
  });

  it("output path is always last argument", () => {
    const args = buildHevcArgs("/in.mp4", "/my/output.mp4", "8M", "192k", "hevc_videotoolbox");
    expect(args[args.length - 1]).toBe("/my/output.mp4");
  });
});
