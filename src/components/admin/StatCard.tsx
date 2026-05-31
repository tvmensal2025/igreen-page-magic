import { TrendingUp } from "lucide-react";

interface StatCardProps {
  icon: React.ReactNode;
  label: string;
  value: number | string;
  color: "primary" | "accent";
  subtitle?: string;
}

export function StatCard({ icon, label, value, color, subtitle }: StatCardProps) {
  const iconBg = color === "primary"
    ? "bg-primary/10 text-primary ring-1 ring-primary/20"
    : "bg-accent/10 text-accent ring-1 ring-accent/20";

  return (
    <div className="feature-card group !p-4 sm:!p-6 flex items-center gap-3 sm:gap-5">
      <div className={`relative w-11 h-11 sm:w-14 sm:h-14 rounded-2xl flex items-center justify-center shrink-0 ${iconBg} transition-transform duration-300 group-hover:scale-110 [&>svg]:w-4 [&>svg]:h-4 sm:[&>svg]:w-6 sm:[&>svg]:h-6`}>
        {icon}
      </div>
      <div className="relative min-w-0 flex-1">
        <p
          className="text-xl sm:text-3xl font-black font-heading text-foreground truncate tracking-tight tabular-nums leading-none"
          title={typeof value === "number" ? value.toLocaleString("pt-BR") : String(value)}
        >
          {typeof value === "number" ? value.toLocaleString("pt-BR") : value}
        </p>
        <p className="text-[11px] sm:text-sm text-muted-foreground font-medium leading-tight truncate mt-1.5">{label}</p>
        {subtitle && <p className="text-[9px] sm:text-[11px] text-muted-foreground/60 mt-0.5 leading-tight truncate">{subtitle}</p>}
      </div>
    </div>
  );
}

