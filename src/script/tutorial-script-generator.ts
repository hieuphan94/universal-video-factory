// Tutorial script generator — LLM-powered: URL + purpose → step-by-step script
// Used in human-assisted flow: AI generates script, human follows while recording.

import Anthropic from "@anthropic-ai/sdk";
import * as fs from "fs";
import * as path from "path";
import { TutorialScriptSchema, type TutorialScript } from "./script-types.js";
import { createLogger } from "../utils/logger.js";

const log = createLogger("script-gen");

const DEFAULT_MODEL = "claude-sonnet-4-20250514";

export interface ScriptGeneratorOptions {
  url: string;
  purpose: string;
  lang?: string;
  /** Optional raw content text (from tree-id or manual input) instead of URL-based generation */
  content?: string;
  model?: string;
}

/**
 * Generate a tutorial script from URL + purpose using Claude.
 * Returns structured steps with instructions (for human) and narration (for TTS).
 */
export async function generateTutorialScript(
  opts: ScriptGeneratorOptions
): Promise<TutorialScript> {
  const apiKey = process.env["ANTHROPIC_API_KEY"];
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY not set");

  const client = new Anthropic({ apiKey });
  const lang = opts.lang ?? "en";
  const model = opts.model ?? DEFAULT_MODEL;

  const prompt = buildPrompt(opts.url, opts.purpose, lang, opts.content);

  log.info(`Generating script for: ${opts.purpose}`);
  log.info(`URL: ${opts.url}, lang: ${lang}`);

  const response = await client.messages.create({
    model,
    max_tokens: 4096,
    messages: [{ role: "user", content: prompt }],
  });

  const rawText = response.content
    .filter((b) => b.type === "text")
    .map((b) => (b as { type: "text"; text: string }).text)
    .join("");

  const script = parseScriptResponse(rawText, lang);
  log.info(`Generated ${script.steps.length} steps, ~${script.totalExpectedDurationSec}s total`);

  return script;
}

/** Save tutorial script to JSON file */
export function saveTutorialScript(script: TutorialScript, outputPath: string): void {
  const dir = path.dirname(outputPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(outputPath, JSON.stringify(script, null, 2), "utf-8");
  log.info(`Saved → ${outputPath}`);
}

function buildPrompt(url: string, purpose: string, lang: string, content?: string): string {
  const contentSection = content
    ? `\n## Additional Context\n${content}\n`
    : "";

  return `You are a tutorial script writer. Generate a step-by-step tutorial script for a screen recording.

## Target
- URL: ${url}
- Purpose: ${purpose}
- Language: ${lang}
${contentSection}
## Requirements
- Each step must be a single, clear action the human can follow while screen recording
- "instruction" = what the human should DO (action-oriented, imperative: "Click...", "Type...", "Navigate...")
- "narration" = what the VIEWER hears as voiceover (natural, explanatory, ${lang} language)
- Keep steps atomic: one click/type/scroll per step when possible
- Include expected duration per step in seconds (how long this action takes to perform + settle)
- 3-10 steps total for a 1-3 minute tutorial
- First step should always be navigating to the page or showing the starting state

## Output Format
Return ONLY valid JSON (no markdown fences, no explanation):
{
  "title": "Short descriptive title",
  "steps": [
    {
      "step": 1,
      "instruction": "What human does",
      "narration": "What viewer hears",
      "expectedDurationSec": 5
    }
  ],
  "totalExpectedDurationSec": 45,
  "lang": "${lang}"
}`;
}

/** Parse LLM response → validated TutorialScript */
function parseScriptResponse(rawText: string, lang: string): TutorialScript {
  // Strip markdown code fences if present
  const cleaned = rawText.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();

  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    throw new Error(`[script-gen] Failed to parse LLM response as JSON:\n${cleaned.slice(0, 300)}`);
  }

  // Validate with Zod
  const result = TutorialScriptSchema.safeParse(parsed);
  if (!result.success) {
    const issues = result.error.issues.map((i) => `  ${i.path.join(".")}: ${i.message}`).join("\n");
    throw new Error(`[script-gen] Invalid script format:\n${issues}`);
  }

  return { ...result.data, lang };
}
