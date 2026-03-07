// Unit tests for src/utils/cleanup.ts

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs/promises";
import * as fsSync from "fs";
import * as path from "path";
import os from "os";
import { cleanupTempFiles, removeCheckpoint } from "../../src/utils/cleanup.js";

describe("cleanupTempFiles", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = fsSync.mkdtempSync(path.join(os.tmpdir(), "vf-cleanup-test-"));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("removes temp/ subdirectory", async () => {
    const tempDir = path.join(tmpDir, "temp");
    await fs.mkdir(tempDir, { recursive: true });
    await fs.writeFile(path.join(tempDir, "file.txt"), "junk");

    await cleanupTempFiles(tmpDir);
    const exists = fsSync.existsSync(tempDir);
    expect(exists).toBe(false);
  });

  it("removes .webm files from root", async () => {
    await fs.writeFile(path.join(tmpDir, "recording.webm"), "data");
    await fs.writeFile(path.join(tmpDir, "final.mp4"), "keep");

    await cleanupTempFiles(tmpDir);
    expect(fsSync.existsSync(path.join(tmpDir, "recording.webm"))).toBe(false);
    expect(fsSync.existsSync(path.join(tmpDir, "final.mp4"))).toBe(true);
  });

  it("removes .tmp files from root", async () => {
    await fs.writeFile(path.join(tmpDir, "scratch.tmp"), "data");
    await cleanupTempFiles(tmpDir);
    expect(fsSync.existsSync(path.join(tmpDir, "scratch.tmp"))).toBe(false);
  });

  it("removes .part files from root", async () => {
    await fs.writeFile(path.join(tmpDir, "download.part"), "data");
    await cleanupTempFiles(tmpDir);
    expect(fsSync.existsSync(path.join(tmpDir, "download.part"))).toBe(false);
  });

  it("removes temp-extension files from scenes/ subdir", async () => {
    const scenesDir = path.join(tmpDir, "scenes");
    await fs.mkdir(scenesDir, { recursive: true });
    await fs.writeFile(path.join(scenesDir, "scene-01.webm"), "data");
    await fs.writeFile(path.join(scenesDir, "scene-01.mp4"), "keep");

    await cleanupTempFiles(tmpDir);
    expect(fsSync.existsSync(path.join(scenesDir, "scene-01.webm"))).toBe(false);
    expect(fsSync.existsSync(path.join(scenesDir, "scene-01.mp4"))).toBe(true);
  });

  it("handles missing scenes/ dir gracefully", async () => {
    // No scenes/ dir exists — should not throw
    await expect(cleanupTempFiles(tmpDir)).resolves.not.toThrow();
  });

  it("handles missing temp/ dir gracefully", async () => {
    await expect(cleanupTempFiles(tmpDir)).resolves.not.toThrow();
  });

  it("case-insensitive extension matching (e.g. .WEBM)", async () => {
    await fs.writeFile(path.join(tmpDir, "FILE.WEBM"), "data");
    await cleanupTempFiles(tmpDir);
    expect(fsSync.existsSync(path.join(tmpDir, "FILE.WEBM"))).toBe(false);
  });
});

describe("removeCheckpoint", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fsSync.mkdtempSync(path.join(os.tmpdir(), "vf-ckpt-test-"));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("removes .checkpoint.json if it exists", async () => {
    const ckptPath = path.join(tmpDir, ".checkpoint.json");
    await fs.writeFile(ckptPath, "{}");
    await removeCheckpoint(tmpDir);
    expect(fsSync.existsSync(ckptPath)).toBe(false);
  });

  it("does not throw if .checkpoint.json is missing", async () => {
    await expect(removeCheckpoint(tmpDir)).resolves.not.toThrow();
  });
});
