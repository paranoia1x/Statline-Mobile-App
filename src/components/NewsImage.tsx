"use client";

import { useState } from "react";

/** Story photo that removes itself if it fails to load (no broken-image boxes). */
export function NewsImage({ src, className }: { src: string; className?: string }) {
  const [ok, setOk] = useState(true);
  if (!ok) return null;
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={src} alt="" loading="lazy" className={className} onError={() => setOk(false)} />;
}
