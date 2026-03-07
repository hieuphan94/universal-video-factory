// Manual browser recording mode — open Playwright browser, wait for user, capture actions

import * as fs from "fs/promises";
import * as path from "path";
import * as readline from "readline";
import { chromium } from "playwright";
import { createLogger } from "../utils/logger.js";

const log = createLogger("manual-mode");

export interface RecordedAction {
  type: "click" | "navigate" | "input" | "scroll";
  url: string;
  x?: number;
  y?: number;
  value?: string;
  timestamp: number;
  screenshotPath?: string;
}

export interface ManualRecordingResult {
  actions: RecordedAction[];
  clickPlanPath: string;
}

/**
 * Open a Playwright browser window and let the user interact manually.
 * Records click/navigate actions and captures screenshots at each action.
 * Press Enter in the terminal to end recording.
 *
 * Generates a basic click_plan.json from recorded actions.
 */
export async function runManualRecording(
  url: string,
  outputDir: string
): Promise<ManualRecordingResult> {
  const screenshotsDir = path.join(outputDir, "manual-screenshots");
  await fs.mkdir(screenshotsDir, { recursive: true });

  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
  });
  const page = await context.newPage();

  const actions: RecordedAction[] = [];
  let screenshotIndex = 0;

  // Record navigation events
  page.on("framenavigated", (frame) => {
    if (frame === page.mainFrame()) {
      actions.push({
        type: "navigate",
        url: frame.url(),
        timestamp: Date.now(),
      });
    }
  });

  // Record click events via CDP
  const cdpSession = await context.newCDPSession(page);
  await cdpSession.send("Input.enable" as Parameters<typeof cdpSession.send>[0]);

  page.on("request", (req) => {
    if (req.resourceType() === "document") {
      actions.push({
        type: "navigate",
        url: req.url(),
        timestamp: Date.now(),
      });
    }
  });

  // Inject click listener into page — runs in browser context (not Node)
  await page.addInitScript(`
    document.addEventListener('click', function(e) {
      window.__lastClick = { x: e.clientX, y: e.clientY, t: Date.now() };
    }, true);
  `);

  log.info(`Browser opened. Navigate to: ${url}`);
  await page.goto(url);

  log.info("Perform the tutorial steps in the browser.");
  log.info("Press ENTER here when done recording...");

  // Poll for clicks every 2 seconds while waiting for user
  let polling = true;
  const pollInterval = setInterval(async () => {
    if (!polling) return;
    try {
      const click = await page.evaluate(`window.__lastClick || null`) as { x: number; y: number; t: number } | null;
      if (click && click.t > (actions[actions.length - 1]?.timestamp ?? 0)) {
        const shotName = `action-${String(++screenshotIndex).padStart(3, "0")}.png`;
        const screenshotPath = path.join(screenshotsDir, shotName);
        try {
          await page.screenshot({ path: screenshotPath });
        } catch {
          // page may have navigated
        }
        actions.push({
          type: "click",
          url: page.url(),
          x: click.x,
          y: click.y,
          timestamp: click.t,
          screenshotPath,
        });
      }
    } catch {
      // Page navigating — skip this tick
    }
  }, 2000);

  // Wait for Enter keypress
  await waitForEnter();
  polling = false;
  clearInterval(pollInterval);

  // Final screenshot
  try {
    const finalShot = path.join(screenshotsDir, "final.png");
    await page.screenshot({ path: finalShot });
  } catch {
    // Non-fatal
  }

  await browser.close();

  // Generate click_plan.json
  const clickPlan = {
    generatedBy: "manual-mode",
    url,
    recordedAt: new Date().toISOString(),
    actions: actions
      .filter((a) => a.type === "click")
      .map((a, i) => ({
        sceneIndex: i,
        description: `User action ${i + 1} at (${a.x ?? 0}, ${a.y ?? 0})`,
        x: a.x ?? 0,
        y: a.y ?? 0,
        screenshotPath: a.screenshotPath,
      })),
  };

  const clickPlanPath = path.join(outputDir, "click_plan.json");
  await fs.writeFile(clickPlanPath, JSON.stringify(clickPlan, null, 2), "utf-8");
  log.info(`Saved ${clickPlan.actions.length} action(s) → ${clickPlanPath}`);

  return { actions, clickPlanPath };
}

function waitForEnter(): Promise<void> {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin });
    rl.once("line", () => {
      rl.close();
      resolve();
    });
  });
}
