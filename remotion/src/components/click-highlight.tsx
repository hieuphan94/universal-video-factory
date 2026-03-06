import React from "react";
import { useCurrentFrame, useVideoConfig, interpolate, spring } from "remotion";

interface ClickHighlightProps {
  /** X coordinate in pixels (relative to composition width) */
  x: number;
  /** Y coordinate in pixels (relative to composition height) */
  y: number;
  /** Absolute frame when this highlight starts */
  startFrame: number;
  /** Ring color, defaults to gold */
  color?: string;
  /** Final ring radius in pixels */
  size?: number;
}

// Total lifetime of the highlight effect in frames
const LIFETIME = 30;

/**
 * Click highlight with:
 *  - Cursor dot (solid circle at click point)
 *  - Primary ring (expanding outward with spring)
 *  - Secondary ring (delayed, larger, fading ripple)
 *  - Subtle glow behind cursor dot
 *
 * Timeline (relative to startFrame):
 *   0-3  : cursor dot appears (scale spring)
 *   2-12 : primary ring expands
 *   6-18 : secondary ripple ring expands
 *   18-30: everything fades out
 */
export const ClickHighlight: React.FC<ClickHighlightProps> = ({
  x,
  y,
  startFrame,
  color = "#FFD700",
  size = 40,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const rel = frame - startFrame;

  if (rel < 0 || rel > LIFETIME) return null;

  // Cursor dot: quick spring scale in, then hold
  const dotScale = spring({
    fps,
    frame: rel,
    config: { damping: 10, stiffness: 300 },
    durationInFrames: 5,
  });

  // Primary ring: expand from 0 → size
  const ring1Progress = spring({
    fps,
    frame: Math.max(0, rel - 2),
    config: { damping: 14, stiffness: 180 },
    durationInFrames: 10,
  });
  const ring1Radius = ring1Progress * size;

  // Secondary ripple: delayed, larger
  const ring2Progress = spring({
    fps,
    frame: Math.max(0, rel - 6),
    config: { damping: 18, stiffness: 120 },
    durationInFrames: 12,
  });
  const ring2Radius = ring2Progress * size * 1.6;

  // Global fade out in the last 12 frames
  const fadeOut = interpolate(rel, [LIFETIME - 12, LIFETIME], [1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  // Ring opacity: fade as they expand
  const ring1Opacity = interpolate(ring1Progress, [0, 0.5, 1], [0, 0.8, 0.4]) * fadeOut;
  const ring2Opacity = interpolate(ring2Progress, [0, 0.5, 1], [0, 0.5, 0.15]) * fadeOut;

  const dotRadius = 6;

  return (
    <svg
      style={{
        position: "absolute",
        top: 0,
        left: 0,
        width: "100%",
        height: "100%",
        pointerEvents: "none",
        overflow: "visible",
      }}
    >
      {/* Glow behind cursor dot */}
      <circle
        cx={x}
        cy={y}
        r={16}
        fill={color}
        opacity={0.25 * dotScale * fadeOut}
        filter="url(#clickGlow)"
      />

      {/* Secondary ripple ring (outer, thinner) */}
      <circle
        cx={x}
        cy={y}
        r={Math.max(0, ring2Radius)}
        fill="none"
        stroke={color}
        strokeWidth={1.5}
        opacity={ring2Opacity}
      />

      {/* Primary ring (inner, thicker) */}
      <circle
        cx={x}
        cy={y}
        r={Math.max(0, ring1Radius)}
        fill="none"
        stroke={color}
        strokeWidth={3}
        opacity={ring1Opacity}
      />

      {/* Cursor dot (solid) */}
      <circle
        cx={x}
        cy={y}
        r={dotRadius * dotScale}
        fill={color}
        opacity={fadeOut}
      />

      {/* SVG filter for glow effect */}
      <defs>
        <filter id="clickGlow" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="6" result="blur" />
        </filter>
      </defs>
    </svg>
  );
};
