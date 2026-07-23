import { ReactNode, CSSProperties } from "react";
import { cn } from "@/lib/utils";

interface AdsTileProps {
  label?: string;
  icon?: ReactNode;
  action?: ReactNode;
  className?: string;
  colSpan?: number; // 1..12
  rowSpan?: number;
  delay?: number; // ms
  children: ReactNode;
}

/**
 * AdsTile — bento tile usado no escopo .ads-central-2026.
 * Apenas visual: não conhece nada do domínio.
 */
export function AdsTile({
  label,
  icon,
  action,
  className,
  colSpan,
  rowSpan,
  delay = 0,
  children,
}: AdsTileProps) {
  const style: CSSProperties = {
    gridColumn: colSpan ? `span ${colSpan} / span ${colSpan}` : undefined,
    gridRow: rowSpan ? `span ${rowSpan} / span ${rowSpan}` : undefined,
    animationDelay: `${delay}ms`,
  };
  return (
    <div className={cn("ads-tile flex flex-col min-w-0 w-full max-w-full overflow-hidden", className)} style={style}>
      {(label || action) && (
        <div className="flex items-center justify-between mb-2 gap-2 min-w-0">
          {label && (
            <span className="ads-tile-label min-w-0 truncate">
              {icon}
              <span className="truncate">{label}</span>
            </span>
          )}
          {action}
        </div>
      )}
      <div className="flex-1 min-w-0 w-full max-w-full overflow-x-clip">{children}</div>
    </div>
  );
}
