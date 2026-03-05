// Unit tests for src/voice/timestamp-merger.ts

import { describe, it, expect } from "vitest";
import { mergeTimestamps } from "../../src/voice/timestamp-merger.js";
import type { WordTimestamp, SceneMarker } from "../../src/voice/types.js";

const SAMPLE_WORDS: WordTimestamp[] = [
  { word: "Welcome",  start: 0.00, end: 0.40 },
  { word: "to",       start: 0.42, end: 0.55 },
  { word: "the",      start: 0.57, end: 0.68 },
  { word: "app",      start: 0.70, end: 0.95 },
  { word: "Click",    start: 1.10, end: 1.40 },
  { word: "the",      start: 1.42, end: 1.52 },
  { word: "sign",     start: 1.54, end: 1.75 },
  { word: "up",       start: 1.77, end: 1.90 },
  { word: "button",   start: 1.92, end: 2.20 },
  { word: "Enter",    start: 3.00, end: 3.35 },
  { word: "your",     start: 3.37, end: 3.50 },
  { word: "email",    start: 3.52, end: 3.85 },
  { word: "and",      start: 3.87, end: 3.97 },
  { word: "password", start: 3.99, end: 4.45 },
];

const SAMPLE_MARKERS: SceneMarker[] = [
  { id: "SCENE:01", afterWordIdx: 0 },
  { id: "SCENE:02", afterWordIdx: 9 },
];

describe("mergeTimestamps", () => {
  it("returns empty result for empty words array", () => {
    const result = mergeTimestamps([], []);
    expect(result.words).toHaveLength(0);
    expect(result.scenes).toHaveLength(0);
    expect(result.total_duration).toBe(0);
  });

  it("returns words unchanged", () => {
    const result = mergeTimestamps(SAMPLE_WORDS, SAMPLE_MARKERS);
    expect(result.words).toHaveLength(SAMPLE_WORDS.length);
    expect(result.words[0].word).toBe("Welcome");
  });

  it("produces correct number of scenes from markers", () => {
    const result = mergeTimestamps(SAMPLE_WORDS, SAMPLE_MARKERS);
    expect(result.scenes).toHaveLength(2);
  });

  it("assigns correct scene IDs", () => {
    const result = mergeTimestamps(SAMPLE_WORDS, SAMPLE_MARKERS);
    expect(result.scenes[0].id).toBe("SCENE:01");
    expect(result.scenes[1].id).toBe("SCENE:02");
  });

  it("scene start_time matches first word start in that scene", () => {
    const result = mergeTimestamps(SAMPLE_WORDS, SAMPLE_MARKERS);
    // SCENE:01 starts at word index 0 → start = 0.00
    expect(result.scenes[0].start_time).toBe(0.00);
    // SCENE:02 starts at word index 9 → start = 3.00
    expect(result.scenes[1].start_time).toBe(3.00);
  });

  it("scene end_time matches last word end in that scene", () => {
    const result = mergeTimestamps(SAMPLE_WORDS, SAMPLE_MARKERS);
    // SCENE:01 ends at word index 8 (one before index 9) → end = 2.20
    expect(result.scenes[0].end_time).toBe(2.20);
    // SCENE:02 ends at last word → end = 4.45
    expect(result.scenes[1].end_time).toBe(4.45);
  });

  it("total_duration equals last word end time", () => {
    const result = mergeTimestamps(SAMPLE_WORDS, SAMPLE_MARKERS);
    expect(result.total_duration).toBe(4.45);
  });

  it("handles no markers — produces no scenes", () => {
    const result = mergeTimestamps(SAMPLE_WORDS, []);
    expect(result.scenes).toHaveLength(0);
    expect(result.words).toHaveLength(SAMPLE_WORDS.length);
  });

  it("clamps out-of-range afterWordIdx to valid range", () => {
    const markers: SceneMarker[] = [{ id: "SCENE:01", afterWordIdx: 999 }];
    const result = mergeTimestamps(SAMPLE_WORDS, markers);
    expect(result.scenes).toHaveLength(1);
    // Should not throw, just clamp
    expect(result.scenes[0].start_word_idx).toBeLessThan(SAMPLE_WORDS.length);
  });
});
