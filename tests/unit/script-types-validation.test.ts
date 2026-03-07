// Unit tests for src/script/script-types.ts — Zod schema validation

import { describe, it, expect } from "vitest";
import { ScriptStepSchema, TutorialScriptSchema } from "../../src/script/script-types.js";

describe("ScriptStepSchema", () => {
  const validStep = {
    step: 1,
    instruction: "Click the Login button",
    narration: "First, let's click the login button to get started.",
    expectedDurationSec: 5,
  };

  it("accepts valid step", () => {
    const result = ScriptStepSchema.safeParse(validStep);
    expect(result.success).toBe(true);
  });

  it("rejects step with non-positive step number", () => {
    expect(ScriptStepSchema.safeParse({ ...validStep, step: 0 }).success).toBe(false);
    expect(ScriptStepSchema.safeParse({ ...validStep, step: -1 }).success).toBe(false);
  });

  it("rejects step with empty instruction", () => {
    expect(ScriptStepSchema.safeParse({ ...validStep, instruction: "" }).success).toBe(false);
  });

  it("rejects step with empty narration", () => {
    expect(ScriptStepSchema.safeParse({ ...validStep, narration: "" }).success).toBe(false);
  });

  it("rejects step with non-positive duration", () => {
    expect(ScriptStepSchema.safeParse({ ...validStep, expectedDurationSec: 0 }).success).toBe(false);
    expect(ScriptStepSchema.safeParse({ ...validStep, expectedDurationSec: -3 }).success).toBe(false);
  });

  it("rejects step with fractional step number", () => {
    expect(ScriptStepSchema.safeParse({ ...validStep, step: 1.5 }).success).toBe(false);
  });

  it("rejects step with missing fields", () => {
    expect(ScriptStepSchema.safeParse({ step: 1 }).success).toBe(false);
    expect(ScriptStepSchema.safeParse({}).success).toBe(false);
  });
});

describe("TutorialScriptSchema", () => {
  const validScript = {
    title: "Login Tutorial",
    steps: [
      { step: 1, instruction: "Navigate to page", narration: "Open the website", expectedDurationSec: 5 },
      { step: 2, instruction: "Click login", narration: "Click the login button", expectedDurationSec: 3 },
    ],
    totalExpectedDurationSec: 8,
    lang: "en",
  };

  it("accepts valid script", () => {
    const result = TutorialScriptSchema.safeParse(validScript);
    expect(result.success).toBe(true);
  });

  it("defaults lang to 'en' when omitted", () => {
    const { lang, ...noLang } = validScript;
    const result = TutorialScriptSchema.safeParse(noLang);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.lang).toBe("en");
    }
  });

  it("rejects empty title", () => {
    expect(TutorialScriptSchema.safeParse({ ...validScript, title: "" }).success).toBe(false);
  });

  it("rejects empty steps array", () => {
    expect(TutorialScriptSchema.safeParse({ ...validScript, steps: [] }).success).toBe(false);
  });

  it("rejects non-positive totalExpectedDurationSec", () => {
    expect(TutorialScriptSchema.safeParse({ ...validScript, totalExpectedDurationSec: 0 }).success).toBe(false);
  });

  it("rejects script with invalid step inside array", () => {
    const badScript = {
      ...validScript,
      steps: [{ step: 0, instruction: "", narration: "", expectedDurationSec: -1 }],
    };
    expect(TutorialScriptSchema.safeParse(badScript).success).toBe(false);
  });

  it("accepts script with many steps", () => {
    const manySteps = Array.from({ length: 10 }, (_, i) => ({
      step: i + 1,
      instruction: `Step ${i + 1}`,
      narration: `Narration ${i + 1}`,
      expectedDurationSec: 5,
    }));
    const result = TutorialScriptSchema.safeParse({
      ...validScript,
      steps: manySteps,
      totalExpectedDurationSec: 50,
    });
    expect(result.success).toBe(true);
  });
});
