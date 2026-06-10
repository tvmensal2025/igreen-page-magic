/**
 * Anel de progresso circular — elemento visual principal do "Cockpit" da
 * Captação. Mostra a % de campos preenchidos com uma animação suave (sem som,
 * sem XP). Usa a paleta iGreen (verde primário) e fica dourado/verde-forte
 * quando completo.
 */
interface ProgressRingProps {
  /** 0 a 100 */
  progress: number;
  /** campos preenchidos */
  filled: number;
  /** total de campos */
  total: number;
  /** diâmetro em px (padrão 56) */
  size?: number;
  /** espessura do anel (padrão 5) */
  stroke?: number;
}

export function ProgressRing({ progress, filled, total, size = 56, stroke = 5 }: ProgressRingProps) {
  const clamped = Math.max(0, Math.min(100, progress));
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (clamped / 100) * circumference;
  const complete = clamped >= 100;

  return (
    <div
      className="relative shrink-0"
      style={{ width: size, height: size }}
      role="img"
      aria-label={`Cadastro ${clamped}% completo, ${filled} de ${total} campos`}
    >
      <svg width={size} height={size} className="-rotate-90">
        {/* trilha de fundo */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="hsl(var(--muted))"
          strokeWidth={stroke}
        />
        {/* progresso */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="hsl(var(--primary))"
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          style={{ transition: "stroke-dashoffset 0.6s cubic-bezier(0.16, 1, 0.3, 1)" }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center leading-none">
        <span className={`font-bold tabular-nums ${complete ? "text-primary" : "text-foreground"}`} style={{ fontSize: size * 0.26 }}>
          {clamped}%
        </span>
      </div>
    </div>
  );
}
