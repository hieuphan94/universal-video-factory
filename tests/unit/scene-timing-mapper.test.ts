// Unit tests for src/compositor/scene-timing-mapper.ts

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { mapProjectToRenderProps } from "../../src/compositor/scene-timing-mapper.js";

describe("mapProjectToRenderProps", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "scene-mapper-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function writeFixtures(metadata: object, timestamps: object) {
    fs.writeFileSync(
      path.join(tmpDir, "capture_metadata.json"),
      JSON.stringify(metadata)
    );
    fs.writeFileSync(
      path.join(tmpDir, "words_timestamps.json"),
      JSON.stringify(timestamps)
    );
  }

  const sampleMetadata = {
    scenes: [
      { id: "SCENE:01", videoFile: "scenes/scene-01.mp4", start: 0, end: 5 },
      { id: "SCENE:02", videoFile: "scenes/scene-02.mp4", start: 5, end: 10 },
    ],
    audioFile: "audio/voiceover.wav",
    totalDuration: 10,
  };

  const sampleTimestamps = {
    words: [
      { word: "Hello", start: 0, end: 0.5 },
      { word: "world", start: 0.5, end: 1.0 },
    ],
  };

  it("converts seconds to frames at 30fps", () => {
    writeFixtures(sampleMetadata, sampleTimestamps);
    const props = mapProjectToRenderProps(tmpDir);

    expect(props.scenes[0].startFrame).toBe(0);
    expect(props.scenes[0].durationFrames).toBe(150); // 5s * 30fps
    expect(props.scenes[1].startFrame).toBe(150);
    expect(props.scenes[1].durationFrames).toBe(150);
  });

  it("maps word timestamps to frame numbers", () => {
    writeFixtures(sampleMetadata, sampleTimestamps);
    const props = mapProjectToRenderProps(tmpDir);

    expect(props.words).toHaveLength(2);
    expect(props.words[0].word).toBe("Hello");
    expect(props.words[0].startFrame).toBe(0);
    expect(props.words[0].endFrame).toBe(15); // 0.5s * 30fps
  });

  it("prefixes video paths with /", () => {
    writeFixtures(sampleMetadata, sampleTimestamps);
    const props = mapProjectToRenderProps(tmpDir);
    expect(props.scenes[0].videoPath).toBe("/scenes/scene-01.mp4");
  });

  it("prefixes audio path with /", () => {
    writeFixtures(sampleMetadata, sampleTimestamps);
    const props = mapProjectToRenderProps(tmpDir);
    expect(props.audioPath).toBe("/audio/voiceover.wav");
  });

  it("calculates totalDurationFrames from metadata", () => {
    writeFixtures(sampleMetadata, sampleTimestamps);
    const props = mapProjectToRenderProps(tmpDir);
    expect(props.totalDurationFrames).toBe(300); // 10s * 30fps
  });

  it("returns fixed output dimensions and fps", () => {
    writeFixtures(sampleMetadata, sampleTimestamps);
    const props = mapProjectToRenderProps(tmpDir);
    expect(props.fps).toBe(30);
    expect(props.width).toBe(1920);
    expect(props.height).toBe(1080);
  });

  it("throws when words_timestamps.json is missing", () => {
    fs.writeFileSync(
      path.join(tmpDir, "capture_metadata.json"),
      JSON.stringify(sampleMetadata)
    );
    expect(() => mapProjectToRenderProps(tmpDir)).toThrow("words_timestamps.json not found");
  });

  it("throws when capture_metadata.json is missing", () => {
    fs.writeFileSync(
      path.join(tmpDir, "words_timestamps.json"),
      JSON.stringify(sampleTimestamps)
    );
    expect(() => mapProjectToRenderProps(tmpDir)).toThrow("capture_metadata.json not found");
  });

  it("handles empty words array", () => {
    writeFixtures(sampleMetadata, { words: [] });
    const props = mapProjectToRenderProps(tmpDir);
    expect(props.words).toHaveLength(0);
  });

  it("handles missing words field gracefully", () => {
    writeFixtures(sampleMetadata, {});
    const props = mapProjectToRenderProps(tmpDir);
    expect(props.words).toHaveLength(0);
  });

  it("ensures minimum 1 frame for very short scenes", () => {
    const metadata = {
      ...sampleMetadata,
      scenes: [{ id: "S1", videoFile: "s.mp4", start: 0, end: 0 }],
    };
    writeFixtures(metadata, sampleTimestamps);
    const props = mapProjectToRenderProps(tmpDir);
    expect(props.scenes[0].durationFrames).toBe(1);
  });
});
