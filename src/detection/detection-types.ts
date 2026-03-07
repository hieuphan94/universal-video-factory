// Marker types for cursor-based detection — output format consumed by Phase 4 renderer

import { z } from "zod";

export const ZoomMarkerSchema = z.object({
  type: z.literal("zoom"),
  startMs: z.number(),
  endMs: z.number(),
  x: z.number(),
  y: z.number(),
  scale: z.number().default(1.8),
});

export const HighlightMarkerSchema = z.object({
  type: z.literal("highlight"),
  startMs: z.number(),
  endMs: z.number(),
  x: z.number(),
  y: z.number(),
  w: z.number(),
  h: z.number(),
});

export const ClickMarkerSchema = z.object({
  type: z.literal("click"),
  ms: z.number(),
  x: z.number(),
  y: z.number(),
});

export const MarkerSchema = z.discriminatedUnion("type", [
  ZoomMarkerSchema,
  HighlightMarkerSchema,
  ClickMarkerSchema,
]);

export const SceneSchema = z.object({
  id: z.number(),
  startMs: z.number(),
  endMs: z.number(),
  title: z.string().optional(),
});

// Sampled cursor position for smooth zoom tracking
export const CursorSampleSchema = z.object({
  ms: z.number(),
  x: z.number(),
  y: z.number(),
});

export const MarkersFileSchema = z.object({
  scenes: z.array(SceneSchema),
  markers: z.array(MarkerSchema),
  cursorTrail: z.array(CursorSampleSchema).default([]),
});

export type ZoomMarker = z.infer<typeof ZoomMarkerSchema>;
export type HighlightMarker = z.infer<typeof HighlightMarkerSchema>;
export type ClickMarker = z.infer<typeof ClickMarkerSchema>;
export type Marker = z.infer<typeof MarkerSchema>;
export type Scene = z.infer<typeof SceneSchema>;
export type CursorSample = z.infer<typeof CursorSampleSchema>;
export type MarkersFile = z.infer<typeof MarkersFileSchema>;
