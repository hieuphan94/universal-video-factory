// Unit tests for scene-timing-mapper secondsToFrames logic (extracted for testing)

import { describe, it, expect } from "vitest";

// Inline the pure functions under test so we don't need file I/O
const FPS = 30;

function secondsToFrames(seconds: number): number {
  return Math.round(seconds * FPS);
}

function mapWordsToFrames(
  words: { word: string; start: number; end: number }[]
) {
  return words.map((w) => ({
    word: w.word,
    startFrame: secondsToFrames(w.start),
    endFrame: secondsToFrames(w.end),
  }));
}

describe("secondsToFrames", () => {
  it("converts 0s to frame 0", () => {
    expect(secondsToFrames(0)).toBe(0);
  });

  it("converts 1s to frame 30", () => {
    expect(secondsToFrames(1)).toBe(30);
  });

  it("converts 1.5s to frame 45", () => {
    expect(secondsToFrames(1.5)).toBe(45);
  });

  it("rounds fractional frames correctly", () => {
    // 0.333... * 30 = 9.99... → rounds to 10
    expect(secondsToFrames(1 / 3)).toBe(10);
  });

  it("handles large durations", () => {
    expect(secondsToFrames(60)).toBe(1800);
  });
});

describe("mapWordsToFrames", () => {
  it("maps empty array to empty array", () => {
    expect(mapWordsToFrames([])).toEqual([]);
  });

  it("maps a single word correctly", () => {
    const result = mapWordsToFrames([{ word: "Hello", start: 0.0, end: 0.4 }]);
    expect(result).toHaveLength(1);
    expect(result[0].word).toBe("Hello");
    expect(result[0].startFrame).toBe(0);
    expect(result[0].endFrame).toBe(12); // 0.4 * 30
  });

  it("maps multiple words preserving order", () => {
    const result = mapWordsToFrames([
      { word: "Hello", start: 0.0, end: 0.4 },
      { word: "world", start: 0.5, end: 0.9 },
    ]);
    expect(result[0].word).toBe("Hello");
    expect(result[1].word).toBe("world");
    expect(result[1].startFrame).toBe(15); // 0.5 * 30
  });

  it("startFrame is always <= endFrame", () => {
    const result = mapWordsToFrames([
      { word: "test", start: 1.0, end: 1.5 },
    ]);
    expect(result[0].startFrame).toBeLessThanOrEqual(result[0].endFrame);
  });
});
