// Unit tests for src/voice/script-preprocessor.ts

import { describe, it, expect } from "vitest";
import { preprocessScript } from "../../src/voice/script-preprocessor.js";

describe("preprocessScript", () => {
  it("strips [SCENE:XX] markers from clean text", () => {
    const input = "[SCENE:01] Hello world. [SCENE:02] Goodbye world.";
    const { cleanText } = preprocessScript(input);
    expect(cleanText).not.toContain("[SCENE:");
    expect(cleanText).toBe("Hello world. Goodbye world.");
  });

  it("records correct number of scene markers", () => {
    const input = "[SCENE:01] First scene. [SCENE:02] Second scene.";
    const { sceneMarkers } = preprocessScript(input);
    expect(sceneMarkers).toHaveLength(2);
  });

  it("records scene marker IDs correctly", () => {
    const input = "[SCENE:01] Alpha. [SCENE:02] Beta.";
    const { sceneMarkers } = preprocessScript(input);
    expect(sceneMarkers[0].id).toBe("SCENE:01");
    expect(sceneMarkers[1].id).toBe("SCENE:02");
  });

  it("records afterWordIdx = 0 for marker at start of text", () => {
    const input = "[SCENE:01] First word here.";
    const { sceneMarkers } = preprocessScript(input);
    expect(sceneMarkers[0].afterWordIdx).toBe(0);
  });

  it("records afterWordIdx > 0 for mid-text marker", () => {
    const input = "Hello world [SCENE:01] next scene";
    const { sceneMarkers } = preprocessScript(input);
    // "Hello world" = 2 words before marker
    expect(sceneMarkers[0].afterWordIdx).toBe(2);
  });

  it("handles script with no markers", () => {
    const input = "No markers here at all.";
    const { cleanText, sceneMarkers } = preprocessScript(input);
    expect(cleanText).toBe("No markers here at all.");
    expect(sceneMarkers).toHaveLength(0);
  });

  it("collapses extra whitespace after marker removal", () => {
    const input = "Word1  [SCENE:01]  Word2";
    const { cleanText } = preprocessScript(input);
    expect(cleanText).not.toMatch(/\s{2,}/);
  });

  it("handles fixture sample-script correctly", () => {
    const input =
      "[SCENE:01] Welcome to the app. Click the sign up button to create your account.\n" +
      "[SCENE:02] Enter your email and password then click submit to complete registration.";
    const { cleanText, sceneMarkers } = preprocessScript(input);
    expect(sceneMarkers).toHaveLength(2);
    expect(cleanText).not.toContain("[SCENE:");
    expect(cleanText.length).toBeGreaterThan(10);
  });
});
