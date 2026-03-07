// Unit tests for src/ai-director/prompts.ts

import { describe, it, expect } from "vitest";
import {
  SCREENSHOT_ANALYSIS_PROMPT,
  SCRIPT_GENERATION_PROMPT,
  CLICK_COORDINATE_REFINEMENT_PROMPT,
} from "../../src/ai-director/prompts.js";

describe("SCREENSHOT_ANALYSIS_PROMPT", () => {
  it("includes feature name in prompt", () => {
    const prompt = SCREENSHOT_ANALYSIS_PROMPT("login form");
    expect(prompt).toContain("login form");
  });

  it("requests JSON output format", () => {
    const prompt = SCREENSHOT_ANALYSIS_PROMPT("signup");
    expect(prompt).toContain("JSON");
    expect(prompt).toContain("elements");
  });

  it("mentions coordinate requirements", () => {
    const prompt = SCREENSHOT_ANALYSIS_PROMPT("test");
    expect(prompt).toContain("x");
    expect(prompt).toContain("y");
    expect(prompt).toContain("confidence");
  });

  it("is trimmed (no leading/trailing whitespace)", () => {
    const prompt = SCREENSHOT_ANALYSIS_PROMPT("test");
    expect(prompt).toBe(prompt.trim());
  });
});

describe("SCRIPT_GENERATION_PROMPT", () => {
  it("includes feature, language, and elements", () => {
    const prompt = SCRIPT_GENERATION_PROMPT("signup", "en", "[button: Sign Up]");
    expect(prompt).toContain("signup");
    expect(prompt).toContain("en");
    expect(prompt).toContain("[button: Sign Up]");
  });

  it("requests scene-based JSON structure", () => {
    const prompt = SCRIPT_GENERATION_PROMPT("test", "vi", "");
    expect(prompt).toContain("scenes");
    expect(prompt).toContain("narration");
    expect(prompt).toContain("actionDescription");
  });

  it("mentions SCENE markers in rawScript", () => {
    const prompt = SCRIPT_GENERATION_PROMPT("test", "en", "");
    expect(prompt).toContain("[SCENE:XX]");
  });
});

describe("CLICK_COORDINATE_REFINEMENT_PROMPT", () => {
  it("includes action description and previous coordinates", () => {
    const prompt = CLICK_COORDINATE_REFINEMENT_PROMPT("click the button", { x: 100, y: 200 });
    expect(prompt).toContain("click the button");
    expect(prompt).toContain("x=100");
    expect(prompt).toContain("y=200");
  });

  it("requests JSON response", () => {
    const prompt = CLICK_COORDINATE_REFINEMENT_PROMPT("test", { x: 0, y: 0 });
    expect(prompt).toContain("JSON");
    expect(prompt).toContain("found");
    expect(prompt).toContain("confidence");
  });
});
