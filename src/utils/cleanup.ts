// Temp file cleanup — removes intermediate files, keeps finals and logs

import * as fs from "fs/promises";
import * as path from "path";

/** File extensions considered intermediate/temporary */
const TEMP_EXTENSIONS = new Set([".webm", ".tmp", ".part"]);

/** File/directory names that are always removed */
const TEMP_DIRS = new Set(["temp"]);

/**
 * Clean up intermediate files from the output directory.
 * Keeps: final video (.mp4 in root), logs, brand assets.
 * Removes: temp/ dir, .webm files, .tmp files.
 */
export async function cleanupTempFiles(outputDir: string): Promise<void> {
  // Remove temp subdirectory entirely
  for (const dirName of TEMP_DIRS) {
    const dirPath = path.join(outputDir, dirName);
    try {
      await fs.rm(dirPath, { recursive: true, force: true });
    } catch {
      // Non-fatal
    }
  }

  // Remove temp-extension files from scenes/ and root
  const dirsToScan = [outputDir, path.join(outputDir, "scenes")];
  for (const dir of dirsToScan) {
    let entries: string[];
    try {
      entries = await fs.readdir(dir);
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (TEMP_EXTENSIONS.has(path.extname(entry).toLowerCase())) {
        try {
          await fs.unlink(path.join(dir, entry));
        } catch {
          // Non-fatal
        }
      }
    }
  }
}

/**
 * Remove the checkpoint file from outputDir (call after successful run).
 */
export async function removeCheckpoint(outputDir: string): Promise<void> {
  try {
    await fs.unlink(path.join(outputDir, ".checkpoint.json"));
  } catch {
    // Already gone — fine
  }
}
