// Unit tests for src/clips/compose-pipeline.ts
// Mocks all external dependencies (voice, render, export, brand, catalog).

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../src/voice/voice-pipeline.js", () => ({
  runVoicePipeline: vi.fn().mockResolvedValue({
    audioPath: "/tmp/out/audio/voiceover.mp3",
    totalDuration: 30.0,
    timestamps: [],
  }),
}));

vi.mock("../../src/compositor/render-engine.js", () => ({
  renderVideo: vi.fn().mockResolvedValue({
    outputPath: "/tmp/out/draft.mp4",
    durationMs: 5000,
    framesRendered: 900,
  }),
}));

vi.mock("../../src/export/ffmpeg-exporter.js", () => ({
  exportFinalVideo: vi.fn().mockResolvedValue({
    finalPath: "/tmp/out/final_1080p.mp4",
    encoder: "libx264",
    durationMs: 3000,
  }),
}));

vi.mock("../../src/compositor/brand-loader.js", () => ({
  loadBrand: vi.fn().mockResolvedValue({ name: "default", colors: {} }),
  toRemotion: vi.fn(),
}));

vi.mock("../../src/clips/compose-metadata-builder.js", () => ({
  buildComposeMetadata: vi.fn().mockReturnValue({ scenes: [] }),
  saveComposeMetadata: vi.fn(),
}));

vi.mock("../../src/utils/logger.js", () => ({
  createLogger: () => ({
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  }),
}));

// Mock fs — track calls without touching filesystem
vi.mock("fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("fs")>();
  return {
    ...actual,
    mkdirSync: vi.fn(),
    writeFileSync: vi.fn(),
    copyFileSync: vi.fn(),
    existsSync: vi.fn(() => true),
  };
});

// Mock CatalogManager
vi.mock("../../src/clips/catalog-manager.js", () => ({
  CatalogManager: vi.fn().mockImplementation(() => ({
    getClip: vi.fn(),
  })),
}));

import * as fs from "fs";
import { runComposePipeline } from "../../src/clips/compose-pipeline.js";
import { runVoicePipeline } from "../../src/voice/voice-pipeline.js";
import { renderVideo } from "../../src/compositor/render-engine.js";
import { exportFinalVideo } from "../../src/export/ffmpeg-exporter.js";
import { CatalogManager } from "../../src/clips/catalog-manager.js";

const baseManifest = {
  clips: [
    { clipId: "clip-1", narration: "First step" },
    { clipId: "clip-2", narration: "Second step" },
  ],
  voice: "voice-id",
  brand: "default",
};

const clipData = (id: string) => ({
  id,
  actionType: "click",
  description: `Clip ${id}`,
  url: "https://example.com",
  videoPath: `/data/clips/${id}.mp4`,
  durationMs: 3000,
  viewportWidth: 1920,
  viewportHeight: 1080,
  fps: 30,
  clickX: 100,
  clickY: 200,
  tags: [],
  recordedAt: "2026-01-01",
});

describe("compose-pipeline", () => {
  let mockGetClip: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    // Get reference to the mock getClip from the CatalogManager mock instance
    mockGetClip = vi.fn().mockImplementation((id: string) => clipData(id));
    vi.mocked(CatalogManager).mockImplementation(() => ({ getClip: mockGetClip }) as any);
    vi.mocked(fs.existsSync).mockReturnValue(true);
  });

  it("returns error when clip not found in catalog", async () => {
    mockGetClip.mockImplementation(() => null);

    const result = await runComposePipeline({
      manifest: baseManifest,
      outputDir: "/tmp/out",
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain("Clip not found");
  });

  it("returns error when clip video file missing", async () => {
    vi.mocked(fs.existsSync).mockReturnValue(false);

    const result = await runComposePipeline({
      manifest: baseManifest,
      outputDir: "/tmp/out",
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain("Clip video missing");
  });

  it("generates script.txt with [SCENE:XX] markers", async () => {
    const result = await runComposePipeline({
      manifest: baseManifest,
      outputDir: "/tmp/out",
    });

    expect(result.success).toBe(true);
    // Check writeFileSync was called with script content
    const scriptCall = vi.mocked(fs.writeFileSync).mock.calls.find((c) =>
      String(c[0]).includes("script.txt")
    );
    expect(scriptCall).toBeDefined();
    const content = scriptCall![1] as string;
    expect(content).toContain("[SCENE:01]");
    expect(content).toContain("[SCENE:02]");
    expect(content).toContain("First step");
    expect(content).toContain("Second step");
  });

  it("calls runVoicePipeline with correct args", async () => {
    await runComposePipeline({
      manifest: { ...baseManifest, lang: "vi" },
      outputDir: "/tmp/out",
    });

    expect(runVoicePipeline).toHaveBeenCalledWith(
      expect.objectContaining({
        outputDir: "/tmp/out",
        voiceId: "voice-id",
        language: "vi",
      })
    );
  });

  it("defaults language to en when not specified", async () => {
    await runComposePipeline({
      manifest: { clips: baseManifest.clips, voice: "v1" },
      outputDir: "/tmp/out",
    });

    expect(runVoicePipeline).toHaveBeenCalledWith(
      expect.objectContaining({ language: "en" })
    );
  });

  it("copies clip videos to scenes/ dir", async () => {
    await runComposePipeline({
      manifest: baseManifest,
      outputDir: "/tmp/out",
    });

    expect(fs.copyFileSync).toHaveBeenCalledTimes(2);
    expect(fs.copyFileSync).toHaveBeenCalledWith(
      "/data/clips/clip-1.mp4",
      expect.stringContaining("scene-01.mp4")
    );
    expect(fs.copyFileSync).toHaveBeenCalledWith(
      "/data/clips/clip-2.mp4",
      expect.stringContaining("scene-02.mp4")
    );
  });

  it("calls renderVideo and exportFinalVideo on happy path", async () => {
    await runComposePipeline({
      manifest: baseManifest,
      outputDir: "/tmp/out",
    });

    expect(renderVideo).toHaveBeenCalledWith(
      expect.objectContaining({ projectDir: "/tmp/out", codec: "h264" })
    );
    expect(exportFinalVideo).toHaveBeenCalled();
  });

  it("returns success with finalPath on happy path", async () => {
    const result = await runComposePipeline({
      manifest: baseManifest,
      outputDir: "/tmp/out",
    });

    expect(result.success).toBe(true);
    expect(result.export).toBeDefined();
    expect(result.export!.finalPath).toContain("final_1080p.mp4");
    expect(result.elapsedMs).toBeGreaterThanOrEqual(0);
  });

  it("uses 720p suffix when preview=true", async () => {
    const result = await runComposePipeline({
      manifest: baseManifest,
      outputDir: "/tmp/out",
      preview: true,
    });

    expect(result.success).toBe(true);
    // exportFinalVideo receives a path with 720p
    expect(exportFinalVideo).toHaveBeenCalledWith(
      expect.any(String),
      expect.stringContaining("720p")
    );
  });

  it("catches and wraps errors in PipelineResult", async () => {
    vi.mocked(renderVideo).mockRejectedValueOnce(new Error("Remotion crashed"));

    const result = await runComposePipeline({
      manifest: baseManifest,
      outputDir: "/tmp/out",
    });

    expect(result.success).toBe(false);
    expect(result.error).toBe("Remotion crashed");
  });
});
