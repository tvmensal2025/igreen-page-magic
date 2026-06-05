interface StatCardProps {
  icon: React.ReactNode;
  label: string;
  value: number | string;
  color?: "primary" | "accent";
  subtitle?: string;
  delta?: { value: number; direction?: "up" | "down" } | null;
}

export function StatCard({ icon, label, value, subtitle, delta }: StatCardProps) {
  const formatted = typeof value === "number" ? value.toLocaleString("pt-BR") : value;
  const dir = delta?.direction ?? (delta && delta.value < 0 ? "down" : "up");

  return (
    <div className="pe-card-kpi group">
      <div className="pe-kpi-icon">{icon}</div>
      <div className="pe-kpi-label" title={label}>{label}</div>
      <div className="pe-kpi-value" title={String(formatted)}>{formatted}</div>
      <div className="flex items-center gap-2 mt-1 min-h-[18px]">
        {delta && (
          <span className={dir === "down" ? "pe-kpi-delta-down" : "pe-kpi-delta-up"}>
            {dir === "down" ? "▼" : "▲"} {Math.abs(delta.value)}%
          </span>
        )}
        {subtitle && <span className="pe-kpi-sub truncate">{subtitle}</span>}
      </div>
    </div>
  );
}
