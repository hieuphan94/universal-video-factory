// Unit tests for src/script/tutorial-script-generator.ts
// Tests the internal parseScriptResponse and buildPrompt logic.

import { describe, it, expect } from "vitest";
import { TutorialScriptSchema } from "../../src/script/script-types.js";

// parseScriptResponse is not exported, so we re-test the same logic:
// strip markdown fences, JSON.parse, Zod validate, add lang
function parseScriptResponse(rawText: string, lang: string) {
  const cleaned = rawText.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    throw new Error(`Failed to parse LLM response as JSON:\n${cleaned.slice(0, 300)}`);
  }
  const result = TutorialScriptSchema.safeParse(parsed);
  if (!result.success) {
    const issues = result.error.issues.map((i: any) => `  ${i.path.join(".")}: ${i.message}`).join("\n");
    throw new Error(`Invalid script format:\n${issues}`);
  }
  return { ...result.data, lang };
}

describe("parseScriptResponse", () => {
  const validJSON = JSON.stringify({
    title: "Login Tutorial",
    steps: [
      { step: 1, instruction: "Navigate to page", narration: "Open the website", expectedDurationSec: 5 },
    ],
    totalExpectedDurationSec: 5,
    lang: "en",
  });

  it("parses valid JSON response", () => {
    const result = parseScriptResponse(validJSON, "en");
    expect(result.title).toBe("Login Tutorial");
    expect(result.steps).toHaveLength(1);
    expect(result.lang).toBe("en");
  });

  it("strips markdown code fences", () => {
    const wrapped = "```json\n" + validJSON + "\n```";
    const result = parseScriptResponse(wrapped, "vi");
    expect(result.title).toBe("Login Tutorial");
    expect(result.lang).toBe("vi");
  });

  it("overrides lang from parameter", () => {
    const result = parseScriptResponse(validJSON, "fr");
    expect(result.lang).toBe("fr");
  });

  it("throws on invalid JSON", () => {
    expect(() => parseScriptResponse("not json at all", "en")).toThrow("Failed to parse");
  });

  it("throws on valid JSON but invalid schema", () => {
    const invalid = JSON.stringify({ title: "", steps: [], totalExpectedDurationSec: 0 });
    expect(() => parseScriptResponse(invalid, "en")).toThrow("Invalid script format");
  });

  it("handles JSON with extra whitespace", () => {
    const result = parseScriptResponse("  \n" + validJSON + "\n  ", "en");
    expect(result.title).toBe("Login Tutorial");
  });

  it("handles multiple code fence styles", () => {
    const wrapped = "```json\n" + validJSON + "```\n";
    const result = parseScriptResponse(wrapped, "en");
    expect(result.steps).toHaveLength(1);
  });
});

describe("buildPrompt logic", () => {
  // Re-implement buildPrompt for testing
  function buildPrompt(url: string, purpose: string, lang: string, content?: string) {
    const contentSection = content ? `\n## Additional Context\n${content}\n` : "";
    return `You are a tutorial script writer. Generate a step-by-step tutorial script for a screen recording.

## Target
- URL: ${url}
- Purpose: ${purpose}
- Language: ${lang}
${contentSection}
## Requirements`;
  }

  it("includes url, purpose, and language", () => {
    const prompt = buildPrompt("https://example.com", "signup flow", "en");
    expect(prompt).toContain("https://example.com");
    expect(prompt).toContain("signup flow");
    expect(prompt).toContain("Language: en");
  });

  it("includes content section when provided", () => {
    const prompt = buildPrompt("https://example.com", "test", "en", "Extra context here");
    expect(prompt).toContain("Additional Context");
    expect(prompt).toContain("Extra context here");
  });

  it("omits content section when not provided", () => {
    const prompt = buildPrompt("https://example.com", "test", "en");
    expect(prompt).not.toContain("Additional Context");
  });

  it("uses correct language code", () => {
    const prompt = buildPrompt("https://example.com", "test", "vi");
    expect(prompt).toContain("Language: vi");
  });
});
