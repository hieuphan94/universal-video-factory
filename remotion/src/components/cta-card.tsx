import React from "react";
import { useCurrentFrame, useVideoConfig, interpolate, spring } from "remotion";

interface CtaCardProps {
  text: string;
  url?: string;
  color: string;
  startFrame: number;
}

const SPRING_CFG = { damping: 14, stiffness: 180 };

/**
 * Animated CTA card with spring bounce and pulse glow effect.
 *
 * Timeline (relative to startFrame):
 *   0-45  : scale spring bounce from 0 to 1
 *   0-45  : opacity fade-in
 *   loop  : subtle pulse glow on the button border
 */
export const CtaCard: React.FC<CtaCardProps> = ({
  text,
  url,
  color,
  startFrame,
}) => {
  const frame = useCurrentFrame();
  const { width } = useVideoConfig();

  const relFrame = Math.max(0, frame - startFrame);

  // Spring scale bounce: 0 -> 1
  const scale = spring({
    fps: 30,
    frame: relFrame,
    config: SPRING_CFG,
    durationInFrames: 45,
  });

  // Opacity fade in
  const opacity = interpolate(relFrame, [0, 20], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  // Pulse glow — oscillates using sine approximation via interpolate loop
  const pulseFrame = relFrame % 60;
  const pulseIntensity = interpolate(
    pulseFrame,
    [0, 30, 60],
    [0.4, 1.0, 0.4],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
  );

  const glowSpread = 8 + pulseIntensity * 16;
  const glowColor = `${color}${Math.round(pulseIntensity * 180)
    .toString(16)
    .padStart(2, "0")}`;

  return (
    <div
      style={{
        opacity,
        transform: `scale(${scale})`,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 12,
      }}
    >
      {/* CTA button */}
      <div
        style={{
          backgroundColor: color,
          borderRadius: 12,
          paddingTop: 20,
          paddingBottom: 20,
          paddingLeft: 48,
          paddingRight: 48,
          maxWidth: width * 0.6,
          boxShadow: `0 0 ${glowSpread}px ${glowColor}, 0 4px 24px rgba(0,0,0,0.4)`,
          border: `2px solid rgba(255,255,255,0.25)`,
        }}
      >
        <div
          style={{
            fontSize: 36,
            fontWeight: 700,
            color: "#FFFFFF",
            fontFamily: "system-ui, -apple-system, sans-serif",
            textAlign: "center",
            letterSpacing: 0.5,
            textShadow: "0 1px 4px rgba(0,0,0,0.5)",
          }}
        >
          {text}
        </div>
      </div>

      {/* URL label beneath button */}
      {url && (
        <div
          style={{
            fontSize: 22,
            fontWeight: 400,
            color: "rgba(255,255,255,0.75)",
            fontFamily: "system-ui, -apple-system, sans-serif",
            letterSpacing: 0.5,
          }}
        >
          {url}
        </div>
      )}
    </div>
  );
};
