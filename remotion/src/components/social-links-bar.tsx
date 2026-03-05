import React from "react";
import { useCurrentFrame, interpolate, spring } from "remotion";

type SocialPlatform = "github" | "twitter" | "youtube" | "website";

interface SocialLink {
  platform: SocialPlatform;
  url: string;
}

interface SocialLinksBarProps {
  links: SocialLink[];
  startFrame: number;
  accentColor?: string;
}

/** Unicode/text icon labels per platform */
const PLATFORM_LABELS: Record<SocialPlatform, string> = {
  github: "GitHub",
  twitter: "Twitter / X",
  youtube: "YouTube",
  website: "Website",
};

/** Simple geometric icon mark per platform using styled text */
const PLATFORM_MARK: Record<SocialPlatform, string> = {
  github: "GH",
  twitter: "TW",
  youtube: "YT",
  website: "WW",
};

const SPRING_CFG = { damping: 16, stiffness: 150 };

/**
 * Social media links row with staggered slide-up animation.
 *
 * Each icon slides up and fades in, staggered by 12 frames per item.
 * startFrame controls when the animation begins.
 */
export const SocialLinksBar: React.FC<SocialLinksBarProps> = ({
  links,
  startFrame,
  accentColor = "#FFD700",
}) => {
  const frame = useCurrentFrame();

  if (links.length === 0) return null;

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
        gap: 32,
      }}
    >
      {links.map((link, index) => {
        const staggerOffset = index * 12;
        const relFrame = Math.max(0, frame - startFrame - staggerOffset);

        const slideProgress = spring({
          fps: 30,
          frame: relFrame,
          config: SPRING_CFG,
          durationInFrames: 30,
        });

        const opacity = interpolate(relFrame, [0, 18], [0, 1], {
          extrapolateLeft: "clamp",
          extrapolateRight: "clamp",
        });

        const translateY = (1 - slideProgress) * 30;

        return (
          <div
            key={link.platform}
            style={{
              opacity,
              transform: `translateY(${translateY}px)`,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: 6,
            }}
          >
            {/* Icon badge */}
            <div
              style={{
                width: 48,
                height: 48,
                borderRadius: 10,
                backgroundColor: accentColor,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 14,
                fontWeight: 700,
                color: "#000000",
                fontFamily: "system-ui, -apple-system, sans-serif",
                letterSpacing: 0.5,
              }}
            >
              {PLATFORM_MARK[link.platform]}
            </div>

            {/* Platform label */}
            <div
              style={{
                fontSize: 14,
                fontWeight: 500,
                color: "rgba(255,255,255,0.8)",
                fontFamily: "system-ui, -apple-system, sans-serif",
                letterSpacing: 0.3,
              }}
            >
              {PLATFORM_LABELS[link.platform]}
            </div>

            {/* URL */}
            <div
              style={{
                fontSize: 12,
                fontWeight: 400,
                color: accentColor,
                fontFamily: "system-ui, -apple-system, sans-serif",
                maxWidth: 140,
                textAlign: "center",
                overflow: "hidden",
                whiteSpace: "nowrap",
                textOverflow: "ellipsis",
              }}
            >
              {link.url}
            </div>
          </div>
        );
      })}
    </div>
  );
};
