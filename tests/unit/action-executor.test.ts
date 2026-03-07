// Unit tests for src/capture/action-executor.ts — regex NL parsing logic
// Tests splitActionSteps (pure) and action description pattern matching.
// Does NOT test Playwright interactions (those need integration tests with a browser).

import { describe, it, expect } from "vitest";

// splitActionSteps is not exported, so we test it indirectly via the regex pattern
// We can test the regex patterns used by executeSmartAction by matching against them directly

describe("action-executor regex patterns", () => {
  // Replicate the splitActionSteps regex from action-executor.ts:84
  function splitActionSteps(description: string): string[] {
    return description.split(/[,.]?\s*[Tt]hen\s+/);
  }

  describe("splitActionSteps", () => {
    it("returns single step for simple description", () => {
      expect(splitActionSteps("Click the Sign In button")).toEqual(["Click the Sign In button"]);
    });

    it('splits on ", then " delimiter', () => {
      const result = splitActionSteps('Click Login, then type username');
      expect(result).toEqual(["Click Login", "type username"]);
    });

    it('splits on ". Then " delimiter', () => {
      const result = splitActionSteps('Click Login. Then type username');
      expect(result).toEqual(["Click Login", "type username"]);
    });

    it("splits on lowercase then", () => {
      const result = splitActionSteps("Click the button then wait for page");
      expect(result).toEqual(["Click the button", "wait for page"]);
    });

    it("handles multiple then delimiters", () => {
      const result = splitActionSteps("Click Login, then type email, then press Enter");
      expect(result).toEqual(["Click Login", "type email", "press Enter"]);
    });

    it("returns single item for empty string", () => {
      expect(splitActionSteps("")).toEqual([""]);
    });

    it("handles 'then' inside quoted text without splitting incorrectly", () => {
      // "then" at word boundary should split
      const result = splitActionSteps('Click then type "hello"');
      expect(result).toEqual(["Click", 'type "hello"']);
    });
  });

  describe("type action regex", () => {
    // Regex from action-executor.ts:115-118
    const typeRegex = /type[^'"]*['"]([^'"]+)['"]/i;
    const enterRegex = /enter[^'"]*['"]([^'"]+)['"]/i;

    it('matches type "value" pattern', () => {
      const match = 'Type "hello@test.com" in the email field'.match(typeRegex);
      expect(match?.[1]).toBe("hello@test.com");
    });

    it("matches type 'value' with single quotes", () => {
      const match = "Type 'my password' in the field".match(typeRegex);
      expect(match?.[1]).toBe("my password");
    });

    it('matches enter "value" pattern', () => {
      const match = 'Enter "John Doe" in the name field'.match(enterRegex);
      expect(match?.[1]).toBe("John Doe");
    });

    it("returns null for no quoted value", () => {
      expect("Type something in the field".match(typeRegex)).toBeNull();
    });

    it("handles special characters in quoted value", () => {
      const match = 'Type "test+user@example.com" in email'.match(typeRegex);
      expect(match?.[1]).toBe("test+user@example.com");
    });
  });

  describe("press key regex", () => {
    // Regex from action-executor.ts:120-121
    const pressKeyRegex = /press\s+(?:the\s+)?(\w+)\s+key/i;
    const pressRegex = /press\s+(\w+)/i;

    it('matches "press Enter key"', () => {
      const match = "press Enter key".match(pressKeyRegex);
      expect(match?.[1]).toBe("Enter");
    });

    it('matches "press the Tab key"', () => {
      const match = "press the Tab key".match(pressKeyRegex);
      expect(match?.[1]).toBe("Tab");
    });

    it('matches "press Enter" without key suffix', () => {
      const match = "press Enter".match(pressRegex);
      expect(match?.[1]).toBe("Enter");
    });

    it("is case-insensitive", () => {
      const match = "Press ESCAPE key".match(pressKeyRegex);
      expect(match?.[1]).toBe("ESCAPE");
    });
  });

  describe("dropdown/select regex", () => {
    // Regex from action-executor.ts:97
    const selectMatch = /['"]([^'"]+)['"]/i;

    it('extracts option from select "Option Name"', () => {
      const match = 'Select "United States" from dropdown'.match(selectMatch);
      expect(match?.[1]).toBe("United States");
    });

    it("extracts option with single quotes", () => {
      const match = "Select 'English' from language dropdown".match(selectMatch);
      expect(match?.[1]).toBe("English");
    });
  });

  describe("context text regex", () => {
    // Regex from action-executor.ts:172-174 (resolveClickTarget)
    const contextRegex = /(?:next to|for|of|labeled?|named?)\s+['"]([^'"]+)['"]/i;

    it('matches labeled "Email"', () => {
      const match = 'Click the field labeled "Email"'.match(contextRegex);
      expect(match?.[1]).toBe("Email");
    });

    it('matches named "Submit"', () => {
      const match = 'Click button named "Submit"'.match(contextRegex);
      expect(match?.[1]).toBe("Submit");
    });

    it('matches next to "Username"', () => {
      const match = 'Click icon next to "Username"'.match(contextRegex);
      expect(match?.[1]).toBe("Username");
    });

    it("returns null for no context", () => {
      expect("Click the button".match(contextRegex)).toBeNull();
    });
  });

  describe("no-action detection", () => {
    it('detects "no action" descriptions', () => {
      const desc = "No action required - just observe the page".toLowerCase();
      expect(desc.includes("no action") || desc.includes("observe")).toBe(true);
    });

    it('detects "observe" descriptions', () => {
      const desc = "Observe the dashboard loading".toLowerCase();
      expect(desc.includes("observe")).toBe(true);
    });

    it("does not match regular click descriptions", () => {
      const desc = "Click the Sign In button".toLowerCase();
      expect(desc.includes("no action") || desc.includes("observe")).toBe(false);
    });
  });

  describe("key mapping", () => {
    const keyMap: Record<string, string> = {
      enter: "Enter", tab: "Tab", escape: "Escape",
      backspace: "Backspace", delete: "Delete", space: "Space",
    };

    it("maps lowercase key names to Playwright keys", () => {
      expect(keyMap["enter"]).toBe("Enter");
      expect(keyMap["tab"]).toBe("Tab");
      expect(keyMap["escape"]).toBe("Escape");
    });

    it("returns undefined for unmapped keys", () => {
      expect(keyMap["f1"]).toBeUndefined();
    });

    it("falls back to raw key name for unmapped", () => {
      const raw = "F1";
      const mapped = keyMap[raw.toLowerCase()] ?? raw;
      expect(mapped).toBe("F1");
    });
  });
});
