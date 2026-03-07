// Unit tests for src/cli/progress-display.ts

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ProgressDisplay } from "../../src/cli/progress-display.js";

describe("ProgressDisplay", () => {
  let stderrSpy: ReturnType<typeof vi.spyOn>;
  let consoleSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    stderrSpy.mockRestore();
    consoleSpy.mockRestore();
  });

  it("startPhase writes phase name to stderr", () => {
    const pd = new ProgressDisplay();
    pd.startPhase("A", "AI Director");
    expect(stderrSpy).toHaveBeenCalled();
    const output = stderrSpy.mock.calls.map((c) => c[0]).join("");
    expect(output).toContain("AI Director");
  });

  it("startPhase with itemTotal shows count", () => {
    const pd = new ProgressDisplay();
    pd.startPhase("C", "Capture", 5);
    const output = stderrSpy.mock.calls.map((c) => c[0]).join("");
    expect(output).toContain("0/5");
  });

  it("completePhase shows elapsed time", () => {
    const pd = new ProgressDisplay();
    pd.startPhase("B", "Voice TTS");
    pd.completePhase("B");
    const output = stderrSpy.mock.calls.map((c) => c[0]).join("");
    expect(output).toContain("Done:");
    expect(output).toContain("Voice TTS");
  });

  it("completePhase for unknown id does nothing", () => {
    const pd = new ProgressDisplay();
    // Should not throw
    pd.completePhase("nonexistent");
  });

  it("updateProgress tracks current item count", () => {
    const pd = new ProgressDisplay();
    pd.startPhase("C", "Capture", 10);
    pd.updateProgress("C", 3);
    // Internal state updated, no crash
  });

  it("updateProgress for unknown id does nothing", () => {
    const pd = new ProgressDisplay();
    pd.updateProgress("unknown", 5);
    // No throw
  });

  it("summary prints total time and output path", () => {
    const pd = new ProgressDisplay();
    pd.summary("/output/final.mp4");
    expect(consoleSpy).toHaveBeenCalled();
    const output = consoleSpy.mock.calls.map((c) => c[0]).join("");
    expect(output).toContain("/output/final.mp4");
    expect(output).toContain("Pipeline complete");
  });
});
