// Phase A handler — Screenshot analysis → Script → Click Plan
// Extracted from pipeline-coordinator.ts to keep it under 200 lines.

import * as path from "path";
import { ScreenshotAnalyzer } from "../ai-director/screenshot-analyzer.js";
import { ScriptGenerator } from "../ai-director/script-generator.js";
import { ClickPlanBuilder } from "../ai-director/click-plan-builder.js";
import { BrowserManager } from "../capture/browser-manager.js";
import type { PipelineConfig, CaptureResult } from "./types.js";
import type { DirectorConfig } from "../ai-director/types.js";
import type { BrowserConfig } from "../capture/types.js";
import { createLogger } from "../utils/logger.js";

const log = createLogger("pipeline");

/** Run Phase A: screenshot → Claude Vision → script + click plan */
export async function runAIDirectorPhase(
  config: PipelineConfig,
  browserConfig: BrowserConfig,
  dirs: { output: string; temp: string }
): Promise<CaptureResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not set. Add it to .env.local");

  const directorConfig: DirectorConfig = {
    anthropicApiKey: apiKey,
    model: "claude-sonnet-4-6",
    confidenceThreshold: parseFloat(process.env.CLAUDE_VISION_CONFIDENCE_THRESHOLD ?? "0.7"),
    viewportWidth: parseInt(process.env.VIEWPORT_WIDTH ?? "1920"),
    viewportHeight: parseInt(process.env.VIEWPORT_HEIGHT ?? "1080"),
  };

  const browserManager = new BrowserManager(browserConfig);

  log.info("Phase A: Launching browser for screenshot...");
  await browserManager.launch(dirs.temp);
  let screenshotPath = "";

  try {
    await browserManager.navigateTo(config.url);

    if (config.manual) {
      log.info("MANUAL MODE — press Enter after navigating to desired state...");
      await new Promise<void>((resolve) => process.stdin.once("data", () => resolve()));
    }

    screenshotPath = path.join(dirs.temp, "initial-screenshot.png");
    await browserManager.screenshot(screenshotPath);
    log.info(`Screenshot saved: ${screenshotPath}`);
  } finally {
    await browserManager.close();
  }

  const analyzer = new ScreenshotAnalyzer(directorConfig);
  log.info("Analyzing screenshot with Claude Vision...");
  const analysis = await analyzer.analyze(screenshotPath, config.feature);
  log.info(`Found ${analysis.elements.length} relevant element(s)`);

  const scriptGen = new ScriptGenerator(directorConfig);
  log.info("Generating script...");
  const script = await scriptGen.generate(analysis.elements, config.feature, config.lang, dirs.output);
  log.info(`Script has ${script.scenes.length} scene(s)`);

  const planBuilder = new ClickPlanBuilder(directorConfig);
  const clickPlan = planBuilder.build(script, analysis.elements, config.url, config.feature);
  const clickPlanPath = await planBuilder.save(clickPlan, dirs.output);

  return {
    scenes: [],
    scriptPath: path.join(dirs.output, "script.txt"),
    clickPlanPath,
    metadataPath: path.join(dirs.output, "capture_metadata.json"),
    outputDir: dirs.output,
  };
}
