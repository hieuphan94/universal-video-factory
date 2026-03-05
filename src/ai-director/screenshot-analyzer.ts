// Claude Vision screenshot analyzer — sends screenshots to Claude, returns element coordinates

import Anthropic from "@anthropic-ai/sdk";
import * as fs from "fs";
import type { DirectorConfig, ElementMap, ScreenshotAnalysis } from "./types.js";
import { SCREENSHOT_ANALYSIS_PROMPT } from "./prompts.js";
import { withRetry } from "../utils/retry.js";

export class ScreenshotAnalyzer {
  private client: Anthropic;
  private config: DirectorConfig;

  constructor(config: DirectorConfig) {
    this.config = config;
    this.client = new Anthropic({ apiKey: config.anthropicApiKey });
  }

  /**
   * Analyze a screenshot and return identified UI elements with coordinates.
   * @param screenshotPath - Path to PNG screenshot file
   * @param feature - Feature description to scope the analysis
   */
  async analyze(screenshotPath: string, feature: string): Promise<ScreenshotAnalysis> {
    const imageData = fs.readFileSync(screenshotPath);
    const base64Image = imageData.toString("base64");

    const response = await withRetry(() => this.client.messages.create({
      model: this.config.model,
      max_tokens: 4096,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image",
              source: {
                type: "base64",
                media_type: "image/png",
                data: base64Image,
              },
            },
            {
              type: "text",
              text: SCREENSHOT_ANALYSIS_PROMPT(feature),
            },
          ],
        },
      ],
    }));

    const rawText = response.content
      .filter((b) => b.type === "text")
      .map((b) => (b as { type: "text"; text: string }).text)
      .join("");

    return this.parseAnalysisResponse(rawText, feature);
  }

  /** Parse and validate Claude's JSON response */
  private parseAnalysisResponse(rawText: string, feature: string): ScreenshotAnalysis {
    let parsed: {
      pageTitle?: string;
      pageDescription?: string;
      elements?: ElementMap[];
    };

    try {
      // Strip potential markdown fences if model added them
      const cleaned = rawText.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
      parsed = JSON.parse(cleaned);
    } catch {
      console.warn("[ScreenshotAnalyzer] Failed to parse Claude response as JSON");
      console.warn("[ScreenshotAnalyzer] Raw:", rawText.slice(0, 500));
      return { elements: [], pageTitle: "", pageDescription: "", rawResponse: rawText };
    }

    const elements = (parsed.elements ?? []).filter((el) =>
      this.isValidElement(el)
    );

    return {
      elements,
      pageTitle: parsed.pageTitle ?? "",
      pageDescription: parsed.pageDescription ?? "",
      rawResponse: rawText,
    };
  }

  /** Validate element coordinates are within viewport */
  private isValidElement(el: ElementMap): boolean {
    return (
      typeof el.x === "number" &&
      typeof el.y === "number" &&
      el.x >= 0 &&
      el.x <= this.config.viewportWidth &&
      el.y >= 0 &&
      el.y <= this.config.viewportHeight &&
      typeof el.confidence === "number"
    );
  }
}
