// Playwright browser lifecycle manager — launch, configure viewport, inject cookies

import { chromium, Browser, BrowserContext, Page } from "playwright";
import * as fs from "fs/promises";
import * as path from "path";
import type { BrowserConfig, CookieEntry } from "./types.js";
import { createLogger } from "../utils/logger.js";

const log = createLogger("browser-manager");

export class BrowserManager {
  private config: BrowserConfig;
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;
  private page: Page | null = null;

  constructor(config: BrowserConfig) {
    this.config = config;
  }

  /** Launch browser, set viewport, configure recording, inject cookies if provided */
  async launch(recordingsDir: string): Promise<Page> {
    this.browser = await chromium.launch({ headless: this.config.headless });

    this.context = await this.browser.newContext({
      viewport: {
        width: this.config.viewportWidth,
        height: this.config.viewportHeight,
      },
      recordVideo: {
        dir: recordingsDir,
        size: {
          width: this.config.viewportWidth,
          height: this.config.viewportHeight,
        },
      },
    });

    if (this.config.cookiesPath) {
      await this.injectCookies(this.config.cookiesPath);
    }

    this.page = await this.context.newPage();

    // Set default timeouts
    this.page.setDefaultTimeout(this.config.clickActionTimeoutMs);
    this.page.setDefaultNavigationTimeout(this.config.pageLoadTimeoutMs);

    log.info(
      `Launched ${this.config.viewportWidth}x${this.config.viewportHeight} headless=${this.config.headless}`
    );

    return this.page;
  }

  /** Navigate to URL and wait for network idle */
  async navigateTo(url: string): Promise<void> {
    if (!this.page) throw new Error("Browser not launched. Call launch() first.");

    // Security: only allow http/https schemes
    const parsed = new URL(url);
    if (!["http:", "https:"].includes(parsed.protocol)) {
      throw new Error(`Blocked URL scheme: ${parsed.protocol}. Only http/https allowed.`);
    }

    await this.page.goto(url, {
      waitUntil: "networkidle",
      timeout: this.config.pageLoadTimeoutMs,
    });
    log.info(`Navigated to ${url}`);
  }

  /** Take a full-page screenshot, return the saved path */
  async screenshot(outputPath: string): Promise<string> {
    if (!this.page) throw new Error("Browser not launched.");
    await this.page.screenshot({ path: outputPath, fullPage: false });
    return outputPath;
  }

  /** Get current page instance */
  getPage(): Page {
    if (!this.page) throw new Error("Browser not launched.");
    return this.page;
  }

  /** Get current context instance */
  getContext(): BrowserContext {
    if (!this.context) throw new Error("Browser not launched.");
    return this.context;
  }

  /** Close browser and clean up */
  async close(): Promise<void> {
    await this.context?.close();
    await this.browser?.close();
    this.page = null;
    this.context = null;
    this.browser = null;
    log.info("Browser closed.");
  }

  /** Read and inject cookies from JSON file — never logs cookie values, only count */
  private async injectCookies(cookiesPath: string): Promise<void> {
    if (!this.context) throw new Error("Context not initialized.");

    try {
      const raw = await fs.readFile(cookiesPath, "utf-8");
      const cookies: CookieEntry[] = JSON.parse(raw);

      await this.context.addCookies(
        cookies.map((c) => ({
          name: c.name,
          value: c.value,
          domain: c.domain,
          path: c.path ?? "/",
          expires: c.expires,
          httpOnly: c.httpOnly,
          secure: c.secure,
          sameSite: c.sameSite ?? "Lax",
        }))
      );

      log.info(`Injected ${cookies.length} cookie(s) from ${path.basename(cookiesPath)}`);
    } catch (err) {
      log.error(`Failed to inject cookies: ${(err as Error).message}`);
      throw err;
    }
  }
}
