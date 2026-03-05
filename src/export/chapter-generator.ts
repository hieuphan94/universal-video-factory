// YouTube chapter generator — creates chapters.txt from capture metadata.
// Format: "MM:SS Title" per scene boundary, suitable for YouTube description.

import * as fs from "fs/promises";
import * as path from "path";

interface SceneEntry {
  id?: string;
  actionDescription?: string;
  start?: number;
  durationMs?: number;
}

interface MetadataInput {
  feature: string;
  scenes: SceneEntry[];
  totalDuration?: number;
}

/** Format seconds as MM:SS */
function formatTimestamp(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
}

/** Clean scene description into a short chapter title */
function toChapterTitle(scene: SceneEntry, index: number): string {
  if (scene.actionDescription) {
    // Capitalize first letter, trim to reasonable length
    const desc = scene.actionDescription.trim();
    const title = desc.charAt(0).toUpperCase() + desc.slice(1);
    return title.length > 60 ? title.slice(0, 57) + "..." : title;
  }
  if (scene.id) {
    return scene.id.replace(/[-_:]/g, " ").trim();
  }
  return `Step ${index + 1}`;
}

/**
 * Generate YouTube chapters from capture metadata.
 * First chapter always starts at 00:00 (YouTube requirement).
 * Returns the chapters text content.
 */
export function generateChapters(metadata: MetadataInput): string {
  const { scenes } = metadata;
  if (scenes.length === 0) return "";

  const lines: string[] = [];
  let cursor = 0;

  for (let i = 0; i < scenes.length; i++) {
    const scene = scenes[i];
    const startSec = scene.start ?? cursor;
    const title = toChapterTitle(scene, i);
    lines.push(`${formatTimestamp(startSec)} ${title}`);
    // Advance cursor for scenes without explicit start time
    if (scene.durationMs) {
      cursor += scene.durationMs / 1000;
    }
  }

  // YouTube requires first chapter at 00:00
  if (!lines[0].startsWith("00:00")) {
    lines[0] = `00:00 ${toChapterTitle(scenes[0], 0)}`;
  }

  return lines.join("\n");
}

/**
 * Generate and save chapters.txt to the output directory.
 * Reads capture_metadata.json from outputDir.
 */
export async function saveChapters(outputDir: string): Promise<string> {
  const metadataPath = path.join(outputDir, "capture_metadata.json");
  const raw = await fs.readFile(metadataPath, "utf-8");
  const metadata = JSON.parse(raw) as MetadataInput;

  const chapters = generateChapters(metadata);
  const chaptersPath = path.join(outputDir, "chapters.txt");
  await fs.writeFile(chaptersPath, chapters, "utf-8");
  console.log(`[chapters] Saved ${metadata.scenes.length} chapter(s) → ${chaptersPath}`);
  return chaptersPath;
}
