import React from "react";
import { useCurrentFrame, useVideoConfig, interpolate, spring } from "remotion";
import { AnimatedText } from "./animated-text";
import type { BrandProps } from "../universal-template/props-schema";

interface IntroSequenceProps {
  brand?: BrandProps;
  featureTitle: string;
  duration: number;
}

const SPRING_CFG = { damping: 20, stiffness: 140 };
const FONT = "system-ui, -apple-system, sans-serif";

/**
 * Professional multi-layer brand intro — 90-150 frames (3-5s at 30fps).
 *
 * Timeline (normalized to 90-frame base, scales with duration):
 *   0-15   : animated gradient background fades in
 *   0-30   : brand name/logo fades in + scales 0.8 → 1.0 (spring)
 *   30-90  : feature title typewriter effect
 *   75-90  : "Let's get started" fades in
 *   last 10: zoom-out + fade transition into content
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

  // Scale timing proportionally when duration differs from 90-frame base
  const scale = duration / 90;
  const t = (f: number) => Math.round(f * scale);

  // Layer 1: Animated gradient background
  const bgOpacity = interpolate(frame, [0, t(15)], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  // Subtle gradient shift over time (hue animation via backgroundPosition)
  const gradientShift = interpolate(frame, [0, duration], [0, 100], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  // Layer 2: Brand name/logo — spring scale 0.8→1.0 + fade in, frames 0-30
  const brandSpring = spring({
    fps,
    frame,
    config: SPRING_CFG,
    durationInFrames: t(30),
  });
  const brandScale = interpolate(brandSpring, [0, 1], [0.8, 1.0]);
  const brandOpacity = interpolate(frame, [0, t(20)], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  // Layer 4: "Let's get started" fade-in, frames 75-90 (scaled)
  const ctaOpacity = interpolate(frame, [t(75), t(88)], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  // Final: zoom-out + fade transition in last 10 frames
  const outroProgress = interpolate(
    frame,
    [duration - 10, duration],
    [0, 1],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
  );
  const containerScale = interpolate(outroProgress, [0, 1], [1, 1.08]);
  const containerOpacity = interpolate(outroProgress, [0, 1], [1, 0]);

  return (
    <div
      style={{
        position: "absolute",
        top: 0,
        left: 0,
        width,
        height,
        overflow: "hidden",
        opacity: containerOpacity,
        transform: `scale(${containerScale})`,
        transformOrigin: "center center",
      }}
    >
      {/* Layer 1: Animated gradient background */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          opacity: bgOpacity,
          background: `linear-gradient(135deg, ${primaryColor} 0%, ${accentColor}33 50%, ${primaryColor} 100%)`,
          backgroundSize: "200% 200%",
          backgroundPosition: `${gradientShift}% ${gradientShift * 0.5}%`,
        }}
      />

      {/* Subtle radial highlight overlay */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          opacity: bgOpacity * 0.4,
          background: `radial-gradient(ellipse at 50% 40%, ${accentColor}22 0%, transparent 70%)`,
        }}
      />

      {/* Content stack — centered */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: 28,
        }}
      >
        {/* Layer 2: Brand name / logo */}
        <div
          style={{
            opacity: brandOpacity,
            transform: `scale(${brandScale})`,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: 16,
          }}
        >
          {brand?.logo ? (
            <img
              src={brand.logo}
              alt={brandName}
              style={{ height: 90, objectFit: "contain" }}
            />
          ) : (
            <div
              style={{
                width: 96,
                height: 96,
                borderRadius: "50%",
                backgroundColor: accentColor,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 44,
                fontWeight: 700,
                color: primaryColor,
                fontFamily: FONT,
                boxShadow: `0 0 40px ${accentColor}66`,
              }}
            >
              {brandName.charAt(0).toUpperCase()}
            </div>
          )}

          <div
            style={{
              fontSize: 54,
              fontWeight: 700,
              color: "#FFFFFF",
              fontFamily: FONT,
              letterSpacing: 3,
              textAlign: "center",
              textShadow: "0 2px 20px rgba(0,0,0,0.5)",
            }}
          >
            {brandName}
          </div>

          {brand?.tagline && (
            <div
              style={{
                fontSize: 20,
                fontWeight: 400,
                color: accentColor,
                fontFamily: FONT,
                letterSpacing: 2,
                opacity: 0.9,
              }}
            >
              {brand.tagline}
            </div>
          )}
        </div>

        {/* Divider */}
        <div
          style={{
            width: 280,
            height: 2,
            backgroundColor: accentColor,
            opacity: brandOpacity * 0.7,
            borderRadius: 1,
          }}
        />

        {/* Layer 3: Feature title — typewriter effect, frames 30-90 */}
        <div
          style={{
            fontSize: 30,
            fontWeight: 500,
            color: "rgba(255,255,255,0.9)",
            fontFamily: FONT,
            textAlign: "center",
            maxWidth: width * 0.65,
            minHeight: 42,
            letterSpacing: 0.5,
          }}
        >
          <AnimatedText
            text={featureTitle}
            mode="typewriter"
            startFrame={t(30)}
            endFrame={t(82)}
          />
        </div>

        {/* Layer 4: "Let's get started" cta line */}
        <div
          style={{
            opacity: ctaOpacity,
            fontSize: 16,
            fontWeight: 400,
            color: accentColor,
            fontFamily: FONT,
            letterSpacing: 4,
            textTransform: "uppercase",
          }}
        >
          Let&apos;s get started
        </div>
      </div>
    </div>
  );
};
