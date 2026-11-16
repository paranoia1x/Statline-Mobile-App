"use client";

import { useEffect, useRef, useState } from "react";
import { cx } from "@/lib/format";

/**
 * Player & team imagery. Every image:
 *  - lazy-loads, shows a loading shimmer, and falls back to a neutral
 *    placeholder on error or when no verified image exists;
 *  - keeps a fixed, consistent box so layouts never shift or stretch.
 * Placeholders never imitate a real photo or official logo.
 */

/**
 * Load state for an <img>. Handles images that finish loading (or fail)
 * before React hydrates, when onLoad/onError never fire.
 */
function useImageState(src: string | null) {
  const ref = useRef<HTMLImageElement>(null);
  const [state, setState] = useState<"loading" | "loaded" | "error">(src ? "loading" : "error");
  useEffect(() => {
    setState(src ? "loading" : "error");
    const img = ref.current;
    if (src && img?.complete) setState(img.naturalWidth > 0 ? "loaded" : "error");
  }, [src]);
  return { ref, state, setState };
}

const SIZES = { xs: 24, sm: 32, md: 44, lg: 64, xl: 112, "2xl": 152 } as const;
type Size = keyof typeof SIZES;

function initials(name: string) {
  const parts = name.split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "") + (parts[parts.length - 1]?.[0] ?? "")).toUpperCase();
}

export function PlayerAvatar({
  name,
  imageUrl,
  size = "md",
  ringColor,
  className,
}: {
  name: string;
  imageUrl: string | null;
  size?: Size;
  ringColor?: string;
  className?: string;
}) {
  const px = SIZES[size];
  const { ref, state, setState } = useImageState(imageUrl);
  const showImg = imageUrl && state !== "error";
  return (
    <span
      className={cx("relative inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-ink-800 transition-transform duration-200 hover:scale-[1.04]", className)}
      style={{ width: px, height: px, boxShadow: `0 0 0 ${px >= 64 ? 2 : 1.5}px ${ringColor ?? "rgb(var(--ink-600))"}` }}
      title={showImg ? name : `${name} — verified headshot unavailable`}
    >
      {showImg ? (
        <>
          {state === "loading" && <span className="absolute inset-0 animate-pulse bg-ink-700" />}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            ref={ref}
            src={imageUrl}
            alt={name}
            width={px}
            height={px}
            loading="lazy"
            decoding="async"
            onLoad={() => setState("loaded")}
            onError={() => setState("error")}
            className={cx("h-full w-full object-cover object-top transition-opacity duration-300", state === "loaded" ? "opacity-100" : "opacity-0")}
          />
        </>
      ) : (
        <PlayerPlaceholder name={name} px={px} />
      )}
    </span>
  );
}

function PlayerPlaceholder({ name, px }: { name: string; px: number }) {
  return (
    <span className="relative flex h-full w-full items-end justify-center" aria-label={`${name} (no verified image)`}>
      <svg viewBox="0 0 64 64" className="absolute inset-0 h-full w-full text-ink-600" aria-hidden>
        <circle cx="32" cy="25" r="11" fill="currentColor" />
        <path d="M10 64c2-14 11-21 22-21s20 7 22 21z" fill="currentColor" />
      </svg>
      {px >= 44 && (
        <span className="relative mb-[8%] rounded bg-ink-900/80 px-1 font-mono text-[10px] font-semibold tracking-wide text-ink-200" style={{ fontSize: Math.max(9, px / 7) }}>
          {initials(name)}
        </span>
      )}
    </span>
  );
}

export function TeamLogo({
  abbreviation,
  name,
  logoUrl,
  colors,
  size = "md",
  className,
}: {
  abbreviation: string;
  name: string;
  logoUrl: string | null;
  colors?: { primary: string; secondary: string };
  size?: Size;
  className?: string;
}) {
  const px = SIZES[size];
  const { ref, state, setState } = useImageState(logoUrl);
  const showImg = logoUrl && state !== "error";
  return (
    <span
      className={cx("relative inline-flex shrink-0 items-center justify-center overflow-hidden rounded-lg border border-ink-700 bg-ink-800 transition-transform duration-200 hover:scale-[1.04]", className)}
      style={{ width: px, height: px }}
      title={showImg ? name : `${name} — official logo unavailable`}
    >
      {showImg ? (
        <>
          {state === "loading" && <span className="absolute inset-0 animate-pulse bg-ink-700" />}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            ref={ref}
            src={logoUrl}
            alt={`${name} logo`}
            width={px}
            height={px}
            loading="lazy"
            decoding="async"
            onLoad={() => setState("loaded")}
            onError={() => setState("error")}
            className={cx("h-full w-full object-contain p-[12%] transition-opacity duration-300", state === "loaded" ? "opacity-100" : "opacity-0")}
          />
        </>
      ) : (
        <span className="flex h-full w-full items-center justify-center" aria-label={`${name} (logo unavailable)`}>
          <span className="absolute inset-x-0 bottom-0 h-[3px]" style={{ background: colors?.primary ?? "rgb(var(--ink-500))" }} />
          <span className="font-mono font-bold tracking-tight text-ink-100" style={{ fontSize: Math.max(8, px / (abbreviation.length > 2 ? 3.4 : 2.6)) }}>
            {abbreviation}
          </span>
        </span>
      )}
    </span>
  );
}
