/**
 * Shell visual do modulo Voz — tokens painel-elite (mesmas cores do Admin).
 */
import type { ReactNode } from "react";

interface Props {
  title: string;
  subtitle: string;
  children: ReactNode;
  footer?: ReactNode;
}

export function VozCampaignShell({ title, subtitle, children, footer }: Props) {
  return (
    <div className="pe-card overflow-hidden">
      <div className="px-5 py-4 border-b" style={{ borderColor: "var(--pe-border)", background: "var(--pe-surface-muted)" }}>
        <h2 className="text-base font-semibold" style={{ color: "var(--pe-text)" }}>{title}</h2>
        <p className="text-xs mt-0.5" style={{ color: "var(--pe-text-muted)" }}>{subtitle}</p>
      </div>
      <div className="p-5 space-y-5" style={{ background: "var(--pe-surface)" }}>{children}</div>
      {footer ? (
        <div
          className="px-5 py-3 border-t flex flex-wrap items-center justify-between gap-2"
          style={{ borderColor: "var(--pe-border)", background: "var(--pe-surface-muted)" }}
        >
          {footer}
        </div>
      ) : null}
    </div>
  );
}

export function VozSection({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="space-y-2.5">
      <h3 className="text-xs font-semibold uppercase tracking-wide" style={{ color: "var(--pe-text-label)" }}>
        {title}
      </h3>
      <div
        className="rounded-[var(--pe-radius)] p-4 space-y-3 border"
        style={{
          borderColor: "var(--pe-border)",
          background: "var(--pe-surface-muted)",
        }}
      >
        {children}
      </div>
    </section>
  );
}
