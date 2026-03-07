// Orchestrator — reads events.json → runs detection analyzers → outputs markers.json
// Converts recording events into render-ready markers (zoom, highlight, click, scenes)

import * as fs from "fs";
import type { RecordingSession } from "../recorder/recorder-types.js";
import { generateClickZooms } from "./click-zoom-generator.js";
import { analyzeDwells } from "./dwell-analyzer.js";
import type { Marker, MarkersFile, Scene, CursorSample } from "./detection-types.js";
import { MarkersFileSchema } from "./detection-types.js";

/** Run full detection pipeline: events.json → markers.json */
export function detectMarkers(session: RecordingSession): MarkersFile {
  // Generate scenes from recording scene boundaries
  const scenes: Scene[] = session.scenes.map((s) => ({
    id: s.step,
    startMs: s.startMs,
    endMs: s.endMs,
  }));

  // Run click → zoom/click markers
  const { zooms, clicks } = generateClickZooms(session.events);

  // Run dwell → highlight markers
  const highlights = analyzeDwells(session.events);

  // Filter out highlights that overlap with zoom markers (zoom already shows the area)
  const filteredHighlights = highlights.filter(
    (h) => !zooms.some((z) => z.startMs <= h.endMs && z.endMs >= h.startMs)
  );

  // Combine all markers, sorted by time
  const markers: Marker[] = [
    ...zooms,
    ...filteredHighlights,
    ...clicks,
  ].sort((a, b) => {
    const aMs = "startMs" in a ? a.startMs : a.ms;
    const bMs = "startMs" in b ? b.startMs : b.ms;
    return aMs - bMs;
  });

  // Sample cursor positions every ~200ms for smooth zoom tracking
  const cursorTrail = sampleCursorTrail(session.events, 200);

  const result: MarkersFile = { scenes, markers, cursorTrail };

  // Validate output with Zod schema
  return MarkersFileSchema.parse(result);
}

/** Sample cursor positions at regular intervals for smooth zoom tracking */
function sampleCursorTrail(events: RecordingSession["events"], intervalMs: number): CursorSample[] {
  const moveEvents = events.filter((e) => e.type === "move" || e.type === "click");
  if (moveEvents.length === 0) return [];

  const trail: CursorSample[] = [];
  let nextSampleMs = 0;

  for (const event of moveEvents) {
    if (event.ms >= nextSampleMs) {
      trail.push({ ms: event.ms, x: event.x, y: event.y });
      nextSampleMs = event.ms + intervalMs;
    }
  }

  return trail;
}

/** Load events.json, run detection, save markers.json */
export async function detectFromFile(
  eventsPath: string,
  outputPath: string
): Promise<MarkersFile> {
  const raw = fs.readFileSync(eventsPath, "utf-8");
  const session: RecordingSession = JSON.parse(raw);

  const markers = detectMarkers(session);

  fs.mkdirSync(outputPath.substring(0, outputPath.lastIndexOf("/")), {
    recursive: true,
  });
  fs.writeFileSync(outputPath, JSON.stringify(markers, null, 2));

  return markers;
}
