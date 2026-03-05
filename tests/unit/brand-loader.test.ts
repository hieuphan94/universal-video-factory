// Unit tests for src/compositor/brand-loader.ts

import { describe, it, expect } from "vitest";
import * as path from "path";
import * as url from "url";
import { loadBrand, toRemotion } from "../../src/compositor/brand-loader.js";

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const FIXTURES = path.resolve(__dirname, "../fixtures");
const SAMPLE_BRAND = path.join(FIXTURES, "sample-brand.json");

describe("loadBrand", () => {
  it("loads a valid brand.json and returns typed config", async () => {
    const brand = await loadBrand(SAMPLE_BRAND);
    expect(brand.name).toBe("Test Brand");
    expect(brand.colors.primary).toBe("#2563EB");
    expect(brand.colors.accent).toBe("#FFD700");
  });

  it("falls back to default brand when no path provided and default file missing", async () => {
    // No path — uses DEFAULT_BRAND_PATH which likely doesn't exist in test env
    const brand = await loadBrand(undefined);
    expect(brand).toBeDefined();
    expect(brand.name).toBeTruthy();
    expect(brand.colors.primary).toBeTruthy();
  });

  it("throws when an explicit path does not exist", async () => {
    await expect(loadBrand("/nonexistent/brand.json")).rejects.toThrow(
      "Brand file not found"
    );
  });

  it("throws ZodError on invalid brand schema", async () => {
    // brand with missing required 'accent' field
    const { tmpdir } = await import("os");
    const { writeFile } = await import("fs/promises");
    const tmpPath = path.join(tmpdir(), "invalid-brand-test.json");
    await writeFile(
      tmpPath,
      JSON.stringify({ name: "Bad", colors: { primary: "#000000" } }),
      "utf-8"
    );
    await expect(loadBrand(tmpPath)).rejects.toThrow();
  });

  it("throws ZodError on invalid hex color format", async () => {
    const { tmpdir } = await import("os");
    const { writeFile } = await import("fs/promises");
    const tmpPath = path.join(tmpdir(), "bad-color-brand-test.json");
    await writeFile(
      tmpPath,
      JSON.stringify({
        name: "Bad Colors",
        colors: { primary: "blue", accent: "red" },
      }),
      "utf-8"
    );
    await expect(loadBrand(tmpPath)).rejects.toThrow();
  });
});

describe("toRemotion", () => {
  it("maps BrandConfig to remotion-compatible shape", async () => {
    const brand = await loadBrand(SAMPLE_BRAND);
    const remotion = toRemotion(brand);
    expect(remotion.name).toBe("Test Brand");
    expect(remotion.colors.primary).toBe("#2563EB");
    expect(remotion.colors.accent).toBe("#FFD700");
    expect(remotion.tagline).toBe("Test tagline");
  });

  it("returns undefined logo when brand has no logo", async () => {
    const brand = await loadBrand(SAMPLE_BRAND);
    const remotion = toRemotion(brand);
    expect(remotion.logo).toBeUndefined();
  });
});
