"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { Menu, X } from "lucide-react";
import { cx } from "@/lib/format";
import { NetworkIndicator } from "@/components/system/NetworkIndicator";
import { ActionLink } from "@/components/system/Actions";
import type { NetworkStatus } from "@/lib/types";

const NAV = [
  { href: "/protocol", label: "Protocol" },
  { href: "/demo", label: "Demo" },
  { href: "/orders", label: "Orders" },
  { href: "/cases", label: "Cases" },
  { href: "/developers", label: "Developers" },
] as const;

export function RecourseMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 16 16"
      aria-hidden
      className={cx("size-4", className)}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.25"
      strokeLinecap="square"
    >
      <rect x="1" y="1" width="14" height="14" />
      <path d="M11 5.5H6.5a2 2 0 0 0 0 4H10" />
      <path d="M8 11.5 6 9.5l2-2" />
    </svg>
  );
}

export function ProtocolHeader({ networkStatus }: { networkStatus: NetworkStatus }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    document.body.style.overflow = open ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [open]);

  const isActive = (href: string) =>
    pathname === href || (href !== "/" && pathname.startsWith(`${href}/`));

  return (
    <header className="sticky top-0 z-40 border-b border-line bg-canvas/92 backdrop-blur-sm">
      <div className="mx-auto flex h-14 max-w-[1400px] items-center gap-4 px-4 sm:px-6 lg:px-8">
        <Link
          href="/"
          className="flex shrink-0 items-center gap-2.5 text-fg transition-opacity hover:opacity-80"
          aria-label="Recourse home"
        >
          <RecourseMark className="text-protected" />
          <span className="font-mono text-[13px] tracking-[0.22em] uppercase">Recourse</span>
        </Link>

        <nav aria-label="Primary" className="ml-6 hidden items-center gap-1 lg:flex">
          {NAV.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              aria-current={isActive(item.href) ? "page" : undefined}
              className={cx(
                "relative px-3 py-2 font-mono text-[11px] tracking-[0.16em] uppercase transition-colors",
                isActive(item.href) ? "text-fg" : "text-fg-dim hover:text-fg-muted",
              )}
            >
              {item.label}
              {isActive(item.href) ? (
                <span className="absolute inset-x-3 -bottom-[1px] h-px bg-protected" aria-hidden />
              ) : null}
            </Link>
          ))}
        </nav>

        <div className="ml-auto flex items-center gap-2 sm:gap-3">
          <NetworkIndicator status={networkStatus} />
          <span className="hidden sm:block">
            <ActionLink href="/demo" variant="primary" size="sm">
              Run demo
            </ActionLink>
          </span>
          <button
            type="button"
            className="inline-flex size-9 items-center justify-center border border-line text-fg-muted transition-colors hover:border-line-strong hover:text-fg lg:hidden"
            aria-expanded={open}
            aria-controls="mobile-nav"
            aria-label={open ? "Close navigation" : "Open navigation"}
            onClick={() => setOpen((v) => !v)}
          >
            {open ? <X className="size-4" aria-hidden /> : <Menu className="size-4" aria-hidden />}
          </button>
        </div>
      </div>

      {open ? (
        <div
          id="mobile-nav"
          className="rc-fade border-t border-line bg-canvas lg:hidden"
        >
          <nav aria-label="Mobile" className="mx-auto max-w-[1400px] px-4 py-2 sm:px-6">
            <ul className="divide-y divide-line">
              {NAV.map((item) => (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    onClick={() => setOpen(false)}
                    aria-current={isActive(item.href) ? "page" : undefined}
                    className={cx(
                      "flex items-center justify-between py-4 font-mono text-[12px] tracking-[0.16em] uppercase",
                      isActive(item.href) ? "text-fg" : "text-fg-muted",
                    )}
                  >
                    {item.label}
                    {isActive(item.href) ? (
                      <span className="size-1.5 rounded-full bg-protected" aria-hidden />
                    ) : null}
                  </Link>
                </li>
              ))}
            </ul>
            <div className="py-4">
              <ActionLink
                href="/demo"
                variant="primary"
                size="md"
                className="w-full"
                onClick={() => setOpen(false)}
              >
                Run protected purchase
              </ActionLink>
            </div>
          </nav>
        </div>
      ) : null}
    </header>
  );
}
