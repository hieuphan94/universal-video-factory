import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as fs from "fs";

vi.mock("fs");

import { fetchTreeNode } from "../../src/integrations/tree-id-client.js";

const sampleData = {
  nodes: [
    {
      id: "demo-login",
      title: "SauceDemo Login Flow",
      url: "https://www.saucedemo.com",
      description: "Login page with username/password fields.",
      tags: ["auth", "login"],
      createdAt: "2026-03-06T00:00:00Z",
    },
    {
      id: "demo-checkout",
      title: "SauceDemo Checkout",
      url: "https://www.saucedemo.com",
      description: "Complete checkout flow.",
      tags: ["checkout", "cart"],
      createdAt: "2026-03-06T00:00:00Z",
    },
  ],
};

beforeEach(() => {
  vi.mocked(fs.existsSync).mockReturnValue(true);
  vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(sampleData));
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("fetchTreeNode", () => {
  it("fetches node by ID from local file", async () => {
    const node = await fetchTreeNode("demo-login", { source: "/test/data.json" });
    expect(node.id).toBe("demo-login");
    expect(node.title).toBe("SauceDemo Login Flow");
    expect(node.url).toBe("https://www.saucedemo.com");
    expect(node.tags).toContain("auth");
  });

  it("throws for unknown node ID", async () => {
    await expect(fetchTreeNode("unknown", { source: "/test/data.json" }))
      .rejects.toThrow('Node "unknown" not found');
  });

  it("throws when sample file missing", async () => {
    vi.mocked(fs.existsSync).mockReturnValue(false);
    await expect(fetchTreeNode("demo-login", { source: "/missing.json" }))
      .rejects.toThrow("sample file not found");
  });

  it("fetches different nodes", async () => {
    const node = await fetchTreeNode("demo-checkout", { source: "/test/data.json" });
    expect(node.id).toBe("demo-checkout");
    expect(node.title).toBe("SauceDemo Checkout");
  });
});
