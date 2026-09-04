import Link from "next/link";
import type { ReactNode } from "react";
import { cx } from "@/lib/format";
import { RecourseMark } from "@/components/layout/ProtocolHeader";

const FOOTER_LINKS = [
  { href: "/protocol", label: "Protocol" },
  { href: "/demo", label: "Demo" },
  { href: "/orders", label: "Orders" },
  { href: "/cases", label: "Cases" },
  { href: "/disputes", label: "Disputes" },
  { href: "/developers", label: "Developers" },
];

export function Footer() {
  return (
    <footer className="mt-24 border-t border-line">
      <div className="mx-auto max-w-[1400px] px-4 py-10 sm:px-6 lg:px-8">
        <div className="flex flex-col gap-8 md:flex-row md:items-start md:justify-between">
          <div className="max-w-sm">
            <div className="flex items-center gap-2.5 text-fg">
              <RecourseMark className="text-protected" />
              <span className="font-mono text-[13px] tracking-[0.22em] uppercase">Recourse</span>
            </div>
            <p className="mt-4 text-sm leading-relaxed text-fg-muted">
              The programmable chargeback layer for autonomous commerce.
            </p>
            <p className="mt-4 font-mono text-[11px] leading-relaxed tracking-[0.08em] text-fg-faint">
              PROMISE → PAYMENT → PROOF → JUDGMENT → SETTLEMENT
            </p>
          </div>

          <nav aria-label="Footer" className="grid grid-cols-2 gap-x-10 gap-y-3 sm:grid-cols-3">
            {FOOTER_LINKS.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className="font-mono text-[11px] tracking-[0.16em] text-fg-dim uppercase transition-colors hover:text-fg"
              >
                {link.label}
              </Link>
            ))}
          </nav>
        </div>

        <div className="mt-10 flex flex-col gap-3 border-t border-line pt-6 sm:flex-row sm:items-center sm:justify-between">
          <p className="font-mono text-[10px] tracking-[0.16em] text-fg-faint uppercase">
            Adjudication on GenLayer · x402 payment rail · escrow settlement not broadcast
          </p>
          <p className="font-mono text-[10px] tracking-[0.16em] text-fg-faint uppercase">
            GenLayer Agent Tank
          </p>
        </div>
      </div>
    </footer>
  );
}

/* ------------------------------------------------------------------ */
/* Page shell primitives                                               */
/* ------------------------------------------------------------------ */

export function PageContainer({
  children,
  className,
  width = "wide",
}: {
  children: ReactNode;
  className?: string;
  width?: "wide" | "narrow";
}) {
  return (
    <div
      className={cx(
        "mx-auto w-full px-4 sm:px-6 lg:px-8",
        width === "wide" ? "max-w-[1400px]" : "max-w-[1040px]",
        className,
      )}
    >
      {children}
    </div>
  );
}

export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
  meta,
  className,
}: {
  eyebrow: string;
  title: string;
  description?: string;
  actions?: ReactNode;
  meta?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cx("border-b border-line pt-10 pb-8 sm:pt-14 sm:pb-10", className)}>
      <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
        <div className="max-w-2xl">
          <p className="mono-label text-protected">{eyebrow}</p>
          <h1 className="mt-4 text-3xl leading-[1.05] tracking-[-0.02em] text-balance sm:text-4xl">
            {title}
          </h1>
          {description ? (
            <p className="mt-4 max-w-xl text-[15px] leading-relaxed text-fg-muted">{description}</p>
          ) : null}
        </div>
        {actions ? <div className="flex flex-wrap items-center gap-3">{actions}</div> : null}
      </div>
      {meta ? <div className="mt-8">{meta}</div> : null}
    </div>
  );
}
