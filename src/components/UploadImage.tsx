import { useEffect, useState } from "react";
import { getStore } from "@/lib/store";

/** Shows a screenshot saved on this device (IndexedDB). */
export function UploadImage({ id, alt, className }: { id: string; alt: string; className?: string }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let u: string | null = null;
    getStore().getUploadUrl(id).then((x) => setUrl((u = x)));
    return () => {
      if (u) URL.revokeObjectURL(u);
    };
  }, [id]);
  if (!url) return <div className={`skeleton ${className ?? ""}`} aria-label={alt} />;
  return <img src={url} alt={alt} className={className} />;
}
