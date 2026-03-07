// Unit tests for src/compositor/render-engine.ts
// Mocks @remotion/bundler, @remotion/renderer, and scene-timing-mapper.

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@remotion/bundler", () => ({
  bundle: vi.fn().mockResolvedValue("/tmp/bundle-dir"),
}));

vi.mock("@remotion/renderer", () => ({
  renderMedia: vi.fn().mockResolvedValue(undefined),
  selectComposition: vi.fn().mockResolvedValue({
    id: "UniversalTemplate",
    durationInFrames: 300,
    fps: 30,
    width: 1920,
    height: 1080,
  }),
}));

vi.mock("../../src/compositor/scene-timing-mapper.js", () => ({
  mapProjectToRenderProps: vi.fn().mockReturnValue({
    scenes: [],
    audioPath: "audio/voiceover.mp3",
    words: [],
    fps: 30,
    width: 1920,
    height: 1080,
    totalDurationFrames: 300,
  }),
}));

vi.mock("../../src/utils/logger.js", () => ({
  createLogger: () => ({
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  }),
}));

// Mock os.freemem to return plenty of RAM (4GB) so safeConcurrency doesn't override
vi.mock("os", async (importOriginal) => {
  const actual = await importOriginal<typeof import("os")>();
  return { ...actual, freemem: vi.fn(() => 4 * 1024 * 1024 * 1024) };
});

vi.mock("fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("fs")>();
  return {
    ...actual,
    existsSync: vi.fn(() => true),
    cpSync: vi.fn(),
    copyFileSync: vi.fn(),
    readdirSync: vi.fn(() => []),
    statSync: vi.fn(() => ({ isFile: () => true })),
  };
});

import { renderVideo } from "../../src/compositor/render-engine.js";
import { bundle } from "@remotion/bundler";
import { renderMedia, selectComposition } from "@remotion/renderer";
import { mapProjectToRenderProps } from "../../src/compositor/scene-timing-mapper.js";

describe("render-engine", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Suppress stdout.write during tests
    vi.spyOn(process.stdout, "write").mockImplementation(() => true);
  });

  it("calls bundle with Remotion entry point", async () => {
    await renderVideo({ projectDir: "/tmp/project", outputPath: "/tmp/out.mp4" });
    expect(bundle).toHaveBeenCalledWith(
      expect.objectContaining({ entryPoint: expect.stringContaining("remotion") })
    );
  });

  it("calls mapProjectToRenderProps with projectDir", async () => {
    await renderVideo({ projectDir: "/tmp/project", outputPath: "/tmp/out.mp4" });
    expect(mapProjectToRenderProps).toHaveBeenCalledWith("/tmp/project");
  });

  it("calls selectComposition with correct composition ID", async () => {
    await renderVideo({ projectDir: "/tmp/project", outputPath: "/tmp/out.mp4" });
    expect(selectComposition).toHaveBeenCalledWith(
      expect.objectContaining({ id: "UniversalTemplate", serveUrl: "/tmp/bundle-dir" })
    );
  });

  it("calls renderMedia with codec and concurrency", async () => {
    await renderVideo({
      projectDir: "/tmp/project",
      outputPath: "/tmp/out.mp4",
      codec: "h265",
      concurrency: 8,
    });
    const call = vi.mocked(renderMedia).mock.calls[0][0] as any;
    expect(call.codec).toBe("h265");
    expect(call.outputLocation).toBe("/tmp/out.mp4");
    expect(call.concurrency).toBe(8);
  });

  it("uses default codec=h264 and concurrency=2", async () => {
    await renderVideo({ projectDir: "/tmp/project", outputPath: "/tmp/out.mp4" });
    const call = vi.mocked(renderMedia).mock.calls[0][0] as any;
    expect(call.codec).toBe("h264");
    expect(call.concurrency).toBe(2);
  });

  it("returns RenderResult with outputPath and framesRendered", async () => {
    const result = await renderVideo({ projectDir: "/tmp/project", outputPath: "/tmp/out.mp4" });
    expect(result.outputPath).toBe("/tmp/out.mp4");
    expect(result.framesRendered).toBe(300);
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("propagates bundle error", async () => {
    vi.mocked(bundle).mockRejectedValueOnce(new Error("Webpack failed"));
    await expect(
      renderVideo({ projectDir: "/tmp/project", outputPath: "/tmp/out.mp4" })
    ).rejects.toThrow("Webpack failed");
  });

  it("propagates renderMedia error", async () => {
    vi.mocked(renderMedia).mockRejectedValueOnce(new Error("Render OOM"));
    await expect(
      renderVideo({ projectDir: "/tmp/project", outputPath: "/tmp/out.mp4" })
    ).rejects.toThrow("Render OOM");
  });

  it("calls onProgress callback during render", async () => {
    const onProgress = vi.fn();
    // Make renderMedia invoke its onProgress callback
    vi.mocked(renderMedia).mockImplementationOnce(async (opts: any) => {
      opts.onProgress({ progress: 0.5 });
      opts.onProgress({ progress: 1.0 });
    });

    await renderVideo({
      projectDir: "/tmp/project",
      outputPath: "/tmp/out.mp4",
      onProgress,
    });

    expect(onProgress).toHaveBeenCalledWith(50);
    expect(onProgress).toHaveBeenCalledWith(100);
  });
});
