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

/**
 * Expanding ring animation at a click position.
 * SVG stroke-only circle (no fill) for a clean cursor-highlight effect.
 *
 * Timeline (relative to startFrame):
 *   0-9  : ring expands from 0 → size (spring)
 *   9-15 : hold at full size, opacity 0.8
 *   15-21: fade out
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
  const relativeFrame = frame - startFrame;

  // Only render during the highlight's lifetime
  if (relativeFrame < 0 || relativeFrame > 21) return null;

  // Spring expansion: frames 0-9
  const expandProgress = spring({
    fps,
    frame: relativeFrame,
    config: { damping: 12, stiffness: 200 },
    durationInFrames: 9,
  });
  const radius = expandProgress * size;

  // Opacity: hold 0.8 from frame 9, fade out from 15-21
  const opacity = interpolate(relativeFrame, [0, 2, 9, 15, 21], [0, 0.8, 0.8, 0.8, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  // Stroke width scales inversely with radius for consistent appearance
  const strokeWidth = Math.max(2, 6 - radius * 0.05);

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
      <circle
        cx={x}
        cy={y}
        r={Math.max(0, radius)}
        fill="none"
        stroke={color}
        strokeWidth={strokeWidth}
        opacity={opacity}
      />
    </svg>
  );
};
