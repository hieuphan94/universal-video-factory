import React from "react";
import { useCurrentFrame, useVideoConfig, interpolate } from "remotion";
import { CtaCard } from "./cta-card";
import { SocialLinksBar } from "./social-links-bar";

interface BrandProps {
  name: string;
  logo?: string;
  colors: { primary: string; accent: string };
  tagline?: string;
}

interface CtaProps {
  text: string;
  url: string;
}

interface OutroSequenceProps {
  brand?: BrandProps;
  cta?: CtaProps;
  duration: number;
}

/**
 * Polished outro animation — 120-180 frames (4-6s at 30fps).
 *
 * Layer timeline (frame numbers relative to this Sequence):
 *   Layer 1 — Background: dark gradient + accent color, fade-in 0-15
 *   Layer 2 — Summary text: slide-in from left, frames 0-45
 *   Layer 3 — CTA card: spring bounce, frames 30-75
 *   Layer 4 — Social links bar: staggered slide-up, frames 60-120
 *   Layer 5 — "Thanks for watching": fade-in, frames 90-120
 *   Final    — Fade to black overlay, last 15 frames
 */
export const OutroSequence: React.FC<OutroSequenceProps> = ({
  brand,
  cta,
  duration,
}) => {
  const frame = useCurrentFrame();
  const { width, height } = useVideoConfig();

  const primaryColor = brand?.colors.primary ?? "#1a1a2e";
  const accentColor = brand?.colors.accent ?? "#FFD700";

  // Layer 1 — background fade-in: frames 0-15
  const bgOpacity = interpolate(frame, [0, 15], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  // Layer 2 — summary text slide-in from left: frames 0-45
  const summaryProgress = interpolate(frame, [0, 45], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const summaryTranslateX = (1 - summaryProgress) * -120;
  const summaryOpacity = interpolate(frame, [0, 30], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  // Layer 5 — "Thanks for watching" fade-in: frames 90-120
  const thanksOpacity = interpolate(frame, [90, 120], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  // Final — fade to black in last 15 frames
  const fadeToBlack = interpolate(
    frame,
    [duration - 15, duration],
    [0, 1],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
  );

  // Derive summary text from CTA or fallback
  const ctaText = cta?.text ?? "Try it yourself";
  const ctaUrl = cta?.url ?? "";
  const summaryText = `That's how you get it done — now it's your turn!`;

  // Minimal social links derived from CTA URL domain (best-effort)
  const socialLinks = ctaUrl
    ? [{ platform: "website" as const, url: ctaUrl }]
    : [];

  return (
    <div
      style={{
        position: "absolute",
        top: 0,
        left: 0,
        width,
        height,
        overflow: "hidden",
      }}
    >
      {/* Layer 1 — Dark gradient background with accent */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          background: `linear-gradient(135deg, ${primaryColor} 0%, #0d0d1a 50%, ${accentColor}22 100%)`,
          opacity: bgOpacity,
        }}
      />

      {/* Subtle accent stripe at top */}
      <div
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          height: 4,
          backgroundColor: accentColor,
          opacity: bgOpacity,
        }}
      />

      {/* Content stack */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: 36,
          paddingLeft: 80,
          paddingRight: 80,
          opacity: bgOpacity,
        }}
      >
        {/* Layer 2 — Summary headline, slides in from left */}
        <div
          style={{
            opacity: summaryOpacity,
            transform: `translateX(${summaryTranslateX}px)`,
            fontSize: 38,
            fontWeight: 600,
            color: "rgba(255,255,255,0.92)",
            fontFamily: "system-ui, -apple-system, sans-serif",
            textAlign: "center",
            maxWidth: width * 0.75,
            lineHeight: 1.3,
            borderLeft: `4px solid ${accentColor}`,
            paddingLeft: 24,
          }}
        >
          {summaryText}
        </div>

        {/* Layer 3 — CTA card, spring bounce starting frame 30 */}
        {cta && (
          <CtaCard
            text={ctaText}
            url={ctaUrl}
            color={accentColor}
            startFrame={30}
          />
        )}

        {/* Layer 4 — Social links bar, staggered slide-up starting frame 60 */}
        {socialLinks.length > 0 && (
          <SocialLinksBar
            links={socialLinks}
            startFrame={60}
            accentColor={accentColor}
          />
        )}

        {/* Layer 5 — "Thanks for watching" fade-in, frames 90-120 */}
        <div
          style={{
            opacity: thanksOpacity,
            fontSize: 22,
            fontWeight: 400,
            color: `rgba(255,255,255,0.6)`,
            fontFamily: "system-ui, -apple-system, sans-serif",
            letterSpacing: 2,
            textTransform: "uppercase",
          }}
        >
          Thanks for watching
        </div>
      </div>

      {/* Fade to black overlay — last 15 frames */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          backgroundColor: "#000",
          opacity: fadeToBlack,
          pointerEvents: "none",
        }}
      />
    </div>
  );
};
