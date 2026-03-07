// Shared action execution logic — extracted from SceneRecorder for reuse by ClipRecorder.
// Interprets natural-language action descriptions and executes Playwright commands.

import type { Page, Locator } from "playwright";
import { createLogger } from "../utils/logger.js";

const log = createLogger("action-executor");

// Delay after typing each character for natural typing appearance
const TYPING_DELAY_MS = 100;

export interface ActionTarget {
  x: number;
  y: number;
  selector?: string;
  description: string;
  useFallback?: boolean;
  waitFor?: "networkidle" | "domcontentloaded" | "load" | "timeout";
  waitMs?: number;
}

/**
 * Execute a browser action by parsing the description for click, type, and keyboard actions.
 * Handles retry logic internally.
 */
export async function executeAction(
  page: Page,
  action: ActionTarget,
  retryAttempts = 2
): Promise<void> {
  const desc = action.description.toLowerCase();
  if (desc.includes("no action") || desc.includes("observe")) return;

  for (let attempt = 1; attempt <= retryAttempts; attempt++) {
    try {
      await executeSmartAction(page, action);
      log.info(`Action executed (attempt ${attempt}): ${action.description}`);
      return;
    } catch (err) {
      log.warn(`Attempt ${attempt} failed: ${(err as Error).message}`);
      if (attempt === retryAttempts) throw err;
      await page.waitForTimeout(500);
    }
  }
}

/**
 * Execute a multi-step action by splitting on ", then " or ". Then " delimiters.
 * Each step is executed sequentially with a brief pause between steps.
 * Falls back to single executeAction if no "then" delimiter found.
 */
export async function executeMultiStepAction(
  page: Page,
  action: ActionTarget,
  retryAttempts = 2
): Promise<void> {
  const steps = splitActionSteps(action.description);
  if (steps.length <= 1) {
    return executeAction(page, action, retryAttempts);
  }

  log.info(`Multi-step action: ${steps.length} steps`);
  for (let i = 0; i < steps.length; i++) {
    const stepDesc = steps[i].trim();
    if (!stepDesc) continue;

    log.info(`Step ${i + 1}/${steps.length}: ${stepDesc}`);
    const stepAction: ActionTarget = {
      ...action,
      description: stepDesc,
    };

    // Re-resolve click target for each step (DOM may have changed)
    const resolved = await resolveClickTarget(page, stepAction);
    if (resolved) {
      stepAction.x = resolved.x;
      stepAction.y = resolved.y;
    }

    await executeAction(page, stepAction, retryAttempts);
    await page.waitForTimeout(500);
  }
}

/** Split action description into steps on "then" boundaries */
function splitActionSteps(description: string): string[] {
  return description.split(/[,.]?\s*[Tt]hen\s+/);
}

/**
 * Smart action execution — interprets the action description to determine
 * what Playwright commands to run (click, type, press keys, etc).
 */
export async function executeSmartAction(page: Page, action: ActionTarget): Promise<void> {
  const desc = action.description;
  const descLower = desc.toLowerCase();

  // Handle dropdown/select early — click to open, select option, return
  if (descLower.includes("dropdown") || descLower.includes("select")) {
    const selectMatch = desc.match(/['"]([^'"]+)['"]/i);
    if (selectMatch) {
      const select = page.locator("select").first();
      if (await select.isVisible().catch(() => false)) {
        const box = await select.boundingBox();
        if (box) {
          await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 15 });
          await page.waitForTimeout(300);
        }
        await select.click();
        await page.waitForTimeout(500);
        await select.selectOption({ label: selectMatch[1] });
        await page.waitForTimeout(500);
        return;
      }
    }
  }

  const typeMatch = desc.match(/type[^'"]*['"]([^'"]+)['"]/i)
    ?? desc.match(/enter[^'"]*['"]([^'"]+)['"]/i)
    ?? desc.match(/example\s+['"]([^'"]+)['"]/i)
    ?? desc.match(/for example\s+['"]([^'"]+)['"]/i);

  const pressMatch = desc.match(/press\s+(?:the\s+)?(\w+)\s+key/i)
    ?? desc.match(/press\s+(\w+)/i);

  if (descLower.includes("click") || descLower.includes("focus")) {
    const clickTarget = await resolveClickTarget(page, action);
    if (clickTarget) {
      await page.mouse.move(clickTarget.x, clickTarget.y, { steps: 15 });
      await page.waitForTimeout(200);
      await page.mouse.click(clickTarget.x, clickTarget.y);
    } else {
      await page.mouse.move(action.x, action.y, { steps: 15 });
      await page.waitForTimeout(200);
      await page.mouse.click(action.x, action.y);
    }
  }

  if (typeMatch) {
    await page.waitForTimeout(300);
    await page.keyboard.type(typeMatch[1], { delay: TYPING_DELAY_MS });
    await page.waitForTimeout(500);
  }

  if (pressMatch) {
    const keyMap: Record<string, string> = {
      enter: "Enter", tab: "Tab", escape: "Escape",
      backspace: "Backspace", delete: "Delete", space: "Space",
    };
    const mappedKey = keyMap[pressMatch[1].toLowerCase()] ?? pressMatch[1];
    await page.waitForTimeout(300);
    await page.keyboard.press(mappedKey);
    await page.waitForTimeout(500);
  }

  if (!descLower.includes("click") && !descLower.includes("focus")
      && !typeMatch && !pressMatch) {
    await page.mouse.move(action.x, action.y, { steps: 15 });
    await page.waitForTimeout(200);
    await page.mouse.click(action.x, action.y);
  }
}

/**
 * Resolve the best click target by parsing the action description for context clues.
 * Uses Playwright locators (role, text, label) to find elements that didn't exist
 * at initial screenshot time.
 */
export async function resolveClickTarget(
  page: Page,
  action: ActionTarget
): Promise<{ x: number; y: number } | null> {
  const desc = action.description.toLowerCase();

  const textContext = action.description.match(
    /(?:next to|for|of|labeled?|named?)\s+['"]([^'"]+)['"]/i
  );
  const contextText = textContext?.[1];

  const locator = await findSmartLocator(page, desc, contextText);
  if (locator) {
    const box = await locator.boundingBox().catch(() => null);
    if (box) {
      return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    }
  }

  if (action.selector) {
    const el = await page.$(action.selector).catch(() => null);
    if (el) {
      await el.scrollIntoViewIfNeeded();
      const box = await el.boundingBox();
      if (box) {
        return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
      }
    }
  }

  return null;
}

/**
 * Find an element using Playwright's semantic locators based on description keywords.
 * Handles checkboxes, buttons, links, and other interactive elements.
 */
export async function findSmartLocator(
  page: Page,
  desc: string,
  contextText?: string
): Promise<Locator | null> {
  try {
    if (desc.includes("checkbox") || desc.includes("check") || desc.includes("toggle") || desc.includes("complete") || desc.includes("mark")) {
      if (contextText) {
        const item = page.locator(`text="${contextText}"`).first();
        if (await item.isVisible().catch(() => false)) {
          const checkbox = item.locator("..").locator('input[type="checkbox"]').first();
          if (await checkbox.isVisible().catch(() => false)) return checkbox;
          const roleCheckbox = item.locator("..").getByRole("checkbox").first();
          if (await roleCheckbox.isVisible().catch(() => false)) return roleCheckbox;
        }
        const container = page.locator(`:has(> :text("${contextText}")) input[type="checkbox"]`).first();
        if (await container.isVisible().catch(() => false)) return container;
      }
      const anyCheckbox = page.getByRole("checkbox").first();
      if (await anyCheckbox.isVisible().catch(() => false)) return anyCheckbox;
    }

    if (desc.includes("button")) {
      const btnTextMatch = desc.match(/['"]([^'"]+)['"]/);
      if (btnTextMatch) {
        const btn = page.getByRole("button", { name: btnTextMatch[1] }).first();
        if (await btn.isVisible().catch(() => false)) return btn;
      }
    }

    if (desc.includes("link") || desc.includes("click on")) {
      const linkTextMatch = desc.match(/['"]([^'"]+)['"]/);
      if (linkTextMatch) {
        const link = page.getByRole("link", { name: linkTextMatch[1] }).first();
        if (await link.isVisible().catch(() => false)) return link;
      }
    }

    // Dropdown/select handled in executeSmartAction — skip here
    if (desc.includes("dropdown") || desc.includes("select")) {
    }
  } catch {
    // Locator strategies are best-effort
  }

  return null;
}

/** Wait for page stability after action */
export async function waitForStability(page: Page, action: ActionTarget): Promise<void> {
  if (action.waitFor === "networkidle") {
    await page.waitForLoadState("networkidle").catch(() => undefined);
  } else if (action.waitFor === "domcontentloaded") {
    await page.waitForLoadState("domcontentloaded").catch(() => undefined);
  } else if (action.waitFor === "load") {
    await page.waitForLoadState("load").catch(() => undefined);
  }

  if (action.waitMs && action.waitMs > 0) {
    await page.waitForTimeout(action.waitMs);
  }
}
