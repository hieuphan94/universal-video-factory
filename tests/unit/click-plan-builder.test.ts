// Unit tests for src/ai-director/click-plan-builder.ts

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as fs from "fs/promises";
import * as fsSync from "fs";
import * as path from "path";
import os from "os";
import { ClickPlanBuilder } from "../../src/ai-director/click-plan-builder.js";
import type { DirectorConfig, ElementMap, GeneratedScript } from "../../src/ai-director/types.js";

const baseConfig: DirectorConfig = {
  viewportWidth: 1920,
  viewportHeight: 1080,
  confidenceThreshold: 0.6,
  maxScenes: 10,
};

const sampleScript: GeneratedScript = {
  title: "Test Tutorial",
  scenes: [
    { index: 1, narration: "Click the sign up button", actionDescription: "click the Sign Up button" },
    { index: 2, narration: "Enter your email", actionDescription: "type email in the input field" },
  ],
  rawScript: "[SCENE:01] Click sign up\n[SCENE:02] Enter email",
};

const sampleElements: ElementMap[] = [
  { element: "button", description: "Sign Up button", x: 500, y: 300, width: 120, height: 40, confidence: 0.9, selector: "#signup-btn" },
  { element: "input", description: "Email input field", x: 500, y: 400, width: 300, height: 36, confidence: 0.85, selector: "input[type=email]" },
  { element: "link", description: "Terms of Service link", x: 500, y: 500, width: 100, height: 20, confidence: 0.7 },
];

describe("ClickPlanBuilder.build", () => {
  it("maps scenes to matching elements by keyword", () => {
    const builder = new ClickPlanBuilder(baseConfig);
    const plan = builder.build(sampleScript, sampleElements, "https://example.com", "signup");

    expect(plan.actions).toHaveLength(2);
    expect(plan.actions[0].x).toBe(500);
    expect(plan.actions[0].y).toBe(300);
    expect(plan.actions[0].confidence).toBeGreaterThan(0);
    expect(plan.actions[0].useFallback).toBe(false);
  });

  it("sets url and feature on plan", () => {
    const builder = new ClickPlanBuilder(baseConfig);
    const plan = builder.build(sampleScript, sampleElements, "https://test.com", "login");
    expect(plan.url).toBe("https://test.com");
    expect(plan.feature).toBe("login");
  });

  it("includes generatedAt timestamp", () => {
    const builder = new ClickPlanBuilder(baseConfig);
    const plan = builder.build(sampleScript, sampleElements, "https://test.com", "test");
    expect(plan.generatedAt).toBeTruthy();
    expect(new Date(plan.generatedAt).getTime()).not.toBeNaN();
  });

  it("uses screen center and flags fallback when no elements match", () => {
    const builder = new ClickPlanBuilder(baseConfig);
    const plan = builder.build(sampleScript, [], "https://test.com", "test");

    expect(plan.actions[0].x).toBe(960); // 1920/2
    expect(plan.actions[0].y).toBe(540); // 1080/2
    expect(plan.actions[0].useFallback).toBe(true);
    expect(plan.actions[0].confidence).toBe(0);
  });

  it("flags low-confidence matches for fallback", () => {
    const lowConfElements: ElementMap[] = [
      { element: "button", description: "Something unrelated", x: 100, y: 100, width: 50, height: 30, confidence: 0.3 },
    ];
    const builder = new ClickPlanBuilder(baseConfig);
    const plan = builder.build(sampleScript, lowConfElements, "https://test.com", "test");

    // Confidence 0.3 + some keyword boost still < 0.6 threshold
    expect(plan.actions[0].useFallback).toBe(true);
  });

  it("preserves narration from script scenes", () => {
    const builder = new ClickPlanBuilder(baseConfig);
    const plan = builder.build(sampleScript, sampleElements, "https://test.com", "test");
    expect(plan.actions[0].narration).toBe("Click the sign up button");
    expect(plan.actions[1].narration).toBe("Enter your email");
  });

  it("preserves sceneIndex from script scenes", () => {
    const builder = new ClickPlanBuilder(baseConfig);
    const plan = builder.build(sampleScript, sampleElements, "https://test.com", "test");
    expect(plan.actions[0].sceneIndex).toBe(1);
    expect(plan.actions[1].sceneIndex).toBe(2);
  });
});

describe("ClickPlanBuilder.save", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fsSync.mkdtempSync(path.join(os.tmpdir(), "vf-cpb-test-"));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("saves click_plan.json to output dir", async () => {
    const builder = new ClickPlanBuilder(baseConfig);
    const plan = builder.build(sampleScript, sampleElements, "https://test.com", "test");

    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    const savedPath = await builder.save(plan, tmpDir);
    spy.mockRestore();

    expect(savedPath).toBe(path.join(tmpDir, "click_plan.json"));
    const content = JSON.parse(await fs.readFile(savedPath, "utf-8"));
    expect(content.actions).toHaveLength(2);
    expect(content.url).toBe("https://test.com");
  });

  it("logs fallback count when actions use fallback", async () => {
    const builder = new ClickPlanBuilder(baseConfig);
    const plan = builder.build(sampleScript, [], "https://test.com", "test");

    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    await builder.save(plan, tmpDir);

    const logs = spy.mock.calls.map((c) => c[0]).join("\n");
    expect(logs).toContain("fallback");
    spy.mockRestore();
  });
});
