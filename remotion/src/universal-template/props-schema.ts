import { z } from "zod";

// Zod schema for a single scene clip
const SceneSchema = z.object({
  id: z.string(),
  videoPath: z.string(),
  startFrame: z.number().int().nonnegative(),
  durationFrames: z.number().int().positive(),
});

// Zod schema for a single word timestamp
const WordSchema = z.object({
  word: z.string(),
  startFrame: z.number().int().nonnegative(),
  endFrame: z.number().int().nonnegative(),
});

// Brand identity schema
const BrandSchema = z.object({
  name: z.string(),
  logo: z.string().optional(),
  colors: z.object({
    primary: z.string(),
    accent: z.string(),
  }),
  tagline: z.string().optional(),
});

// Single click event (cursor position + timing)
const ClickSchema = z.object({
  x: z.number(),
  y: z.number(),
  frame: z.number().int().nonnegative(),
  duration: z.number().int().positive(),
});

// Zoom event (focus area + scale)
const ZoomEventSchema = z.object({
  frame: z.number().int().nonnegative(),
  x: z.number(),
  y: z.number(),
  scale: z.number().min(1).max(2),
  duration: z.number().int().positive(),
});

// Call-to-action for outro
const CtaSchema = z.object({
  text: z.string(),
  url: z.string(),
});

// Step item for PiP step counter (Phase 5)
const StepSchema = z.object({
  id: z.string(),
  label: z.string().optional(),
});

// Main input props schema for UniversalTemplate
export const UniversalTemplatePropsSchema = z.object({
  scenes: z.array(SceneSchema),
  audioPath: z.string(),
  words: z.array(WordSchema),
  fps: z.number().positive().default(30),
  width: z.number().positive().default(1920),
  height: z.number().positive().default(1080),
  totalDurationFrames: z.number().int().positive(),

  // Visual effects (Phase 4)
  brand: BrandSchema.optional(),
  clicks: z.array(ClickSchema).default([]),
  zoomEvents: z.array(ZoomEventSchema).default([]),
  introDuration: z.number().int().nonnegative().default(90),
  outroDuration: z.number().int().nonnegative().default(120),
  cta: CtaSchema.optional(),

  // PiP overlays (Phase 5)
  // steps mirrors scenes but carries display labels; totalScenes = scenes.length
  steps: z.array(StepSchema).default([]),
});

export type UniversalTemplateProps = z.infer<typeof UniversalTemplatePropsSchema>;
export type SceneProps = z.infer<typeof SceneSchema>;
export type WordProps = z.infer<typeof WordSchema>;
export type BrandProps = z.infer<typeof BrandSchema>;
export type ClickProps = z.infer<typeof ClickSchema>;
export type ZoomEventProps = z.infer<typeof ZoomEventSchema>;
export type CtaProps = z.infer<typeof CtaSchema>;
export type StepProps = z.infer<typeof StepSchema>;
