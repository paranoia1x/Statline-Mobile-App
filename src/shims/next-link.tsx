import type { AnchorHTMLAttributes, ReactNode } from "react";
import { toHref } from "@/router";

/** next/link stand-in: renders a hash link. */
export default function Link({ href, children, prefetch: _p, scroll: _s, replace: _r, ...rest }: AnchorHTMLAttributes<HTMLAnchorElement> & { href: string; children?: ReactNode; prefetch?: boolean; scroll?: boolean; replace?: boolean }) {
  const external = /^https?:/.test(href);
  return (
    <a href={toHref(href)} {...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})} {...rest}>
      {children}
    </a>
  );
}
