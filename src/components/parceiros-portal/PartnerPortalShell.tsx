import { cn } from "@/lib/utils";
import type { ReactNode } from "react";

/** Shell dark premium full-bleed do portal do parceiro. */
export function PartnerPortalShell({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "dark min-h-[100dvh] text-foreground relative overflow-x-hidden",
        "bg-[#04140c]",
        className,
      )}
    >
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-90"
        style={{
          background:
            "radial-gradient(ellipse 80% 50% at 50% -10%, rgba(0,168,89,0.35), transparent 55%)," +
            "radial-gradient(ellipse 60% 40% at 100% 20%, rgba(0,200,100,0.12), transparent 50%)," +
            "radial-gradient(ellipse 50% 35% at 0% 80%, rgba(0,120,60,0.18), transparent 45%)",
        }}
      />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-[0.04]"
        style={{
          backgroundImage:
            "url(\"data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E\")",
        }}
      />
      <div className="relative z-10">{children}</div>
    </div>
  );
}
