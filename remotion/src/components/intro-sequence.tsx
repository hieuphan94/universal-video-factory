import React from "react";
import { useCurrentFrame, useVideoConfig, interpolate, spring, Sequence } from "remotion";

interface BrandProps {
  name: string;
  logo?: string;
  colors: { primary: string; accent: string };
  tagline?: string;
}

interface IntroSequenceProps {
  brand?: BrandProps;
  featureTitle: string;
  duration: number;
}

const SPRING_CFG = { damping: 18, stiffness: 160 };

/**
 * Brand intro animation — 90 frames (3s at 30fps).
 *
 * Timeline:
 *   0-15  : background fades in
 *   15-45 : logo scales up with spring + fades in
 *   30-60 : brand name slides in from bottom
 *   45-75 : feature title fades in
 *   75-90 : hold before transition to content
 *
 * Falls back to a generic dark intro when no brand is provided.
 */
export const IntroSequence: React.FC<IntroSequenceProps> = ({
  brand,
  featureTitle,
  duration,
}) => {
  const frame = useCurrentFrame();
  const { width, height, fps } = useVideoConfig();

  const primaryColor = brand?.colors.primary ?? "#1a1a2e";
  const accentColor = brand?.colors.accent ?? "#FFD700";
  const brandName = brand?.name ?? "Video Factory";

  // Background fade in: frames 0-15
  const bgOpacity = interpolate(frame, [0, 15], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  // Logo: scale + fade, frames 15-45 (relative frame inside <Sequence>)
  const logoScale = spring({
    fps,
    frame: Math.max(0, frame - 15),
    config: SPRING_CFG,
    durationInFrames: 30,
  });
  const logoOpacity = interpolate(frame, [15, 30], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  // Brand name slide up: frames 30-60
  const nameProgress = interpolate(frame, [30, 60], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const nameTranslateY = (1 - nameProgress) * 40;

  // Feature title fade: frames 45-75
  const titleOpacity = interpolate(frame, [45, 75], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  // Outro fade: hold, then fade out in last 10 frames of duration
  const outroOpacity = interpolate(
    frame,
    [duration - 10, duration],
    [1, 0],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
  );

  const containerOpacity = Math.min(bgOpacity, outroOpacity);

  return (
    <div
      style={{
        position: "absolute",
        top: 0,
        left: 0,
        width,
        height,
        backgroundColor: primaryColor,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 24,
        opacity: containerOpacity,
        overflow: "hidden",
      }}
    >
      {/* Logo or fallback icon */}
      <div
        style={{
          opacity: logoOpacity,
          transform: `scale(${0.5 + logoScale * 0.5})`,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {brand?.logo ? (
          <img
            src={brand.logo}
            alt={brandName}
            style={{ height: 100, objectFit: "contain" }}
          />
        ) : (
          <div
            style={{
              width: 100,
              height: 100,
              borderRadius: "50%",
              backgroundColor: accentColor,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 48,
              fontWeight: 700,
              color: primaryColor,
              fontFamily: "system-ui, -apple-system, sans-serif",
            }}
          >
            {brandName.charAt(0).toUpperCase()}
          </div>
        )}
      </div>

      {/* Brand name */}
      <div
        style={{
          opacity: nameProgress,
          transform: `translateY(${nameTranslateY}px)`,
          fontSize: 56,
          fontWeight: 700,
          color: "#FFFFFF",
          fontFamily: "system-ui, -apple-system, sans-serif",
          letterSpacing: 2,
          textAlign: "center",
        }}
      >
        {brandName}
        {brand?.tagline && (
          <div
            style={{
              fontSize: 24,
              fontWeight: 400,
              color: accentColor,
              marginTop: 8,
              letterSpacing: 1,
            }}
          >
            {brand.tagline}
          </div>
        )}
      </div>

      {/* Feature title */}
      <div
        style={{
          opacity: titleOpacity,
          fontSize: 32,
          fontWeight: 500,
          color: "rgba(255,255,255,0.85)",
          fontFamily: "system-ui, -apple-system, sans-serif",
          textAlign: "center",
          maxWidth: width * 0.7,
          borderTop: `2px solid ${accentColor}`,
          paddingTop: 16,
        }}
      >
        {featureTitle}
      </div>
    </div>
  );
};
