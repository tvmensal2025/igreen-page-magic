import { Clock, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";

interface KanbanSlaIndicatorProps {
  /** Data ISO em que o deal entrou no estágio atual */
  enteredAt: string | Date;
  /** Limite em dias considerado normal antes de virar alerta. Default 3. */
  warningDays?: number;
  /** Limite em dias considerado crítico (vermelho). Default 7. */
  criticalDays?: number;
  className?: string;
}

/**
 * Indicador visual de tempo no estágio do Kanban.
 * - Verde/cinza até `warningDays`
 * - Amarelo entre `warningDays` e `criticalDays`
 * - Vermelho acima de `criticalDays`
 */
export function KanbanSlaIndicator({
  enteredAt,
  warningDays = 3,
  criticalDays = 7,
  className,
}: KanbanSlaIndicatorProps) {
  const enteredMs = typeof enteredAt === "string" ? new Date(enteredAt).getTime() : enteredAt.getTime();
  const ageMs = Date.now() - enteredMs;
  const ageDays = ageMs / (24 * 3600 * 1000);

  const level: "ok" | "warn" | "critical" =
    ageDays >= criticalDays ? "critical" : ageDays >= warningDays ? "warn" : "ok";

  const colorClass =
    level === "critical"
      ? "text-destructive bg-destructive/10 border-destructive/30"
      : level === "warn"
      ? "text-warning dark:text-warning bg-warning/10 border-warning/30"
      : "text-muted-foreground bg-muted/50 border-border";

  const Icon = level === "critical" ? AlertTriangle : Clock;

  const label =
    ageDays < 1
      ? `${Math.round(ageDays * 24)}h`
      : ageDays < 30
      ? `${Math.round(ageDays)}d`
      : `${Math.round(ageDays / 30)}m`;

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 px-1.5 py-0.5 rounded border text-[10px] font-medium",
        colorClass,
        className,
      )}
      title={`No estágio há ${Math.round(ageDays * 10) / 10} dias`}
    >
      <Icon className="h-2.5 w-2.5" />
      {label}
    </span>
  );
}
