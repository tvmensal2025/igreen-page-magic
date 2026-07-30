import { cn } from "@/lib/utils";
import type { PartnerCycleStep } from "@/lib/partnerPortalCycle";

function polar(cx: number, cy: number, r: number, angleDeg: number) {
  const a = ((angleDeg - 90) * Math.PI) / 180;
  return { x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) };
}

export function PartnerPortalPizzaRing({
  title,
  subtitle,
  steps,
  perStep,
  peopleCount,
  onSliceClick,
  accent = "#00A859",
  gradientId = "pg",
}: {
  title: string;
  subtitle: string;
  steps: PartnerCycleStep[];
  perStep: Record<string, number>;
  peopleCount: number;
  onSliceClick?: (step: PartnerCycleStep) => void;
  accent?: string;
  gradientId?: string;
}) {
  const n = steps.length || 1;
  const size = 380;
  const cx = size / 2;
  const cy = size / 2;
  const r = 102;
  const hole = 52;
  const labelR = 152;
  const activeId =
    Object.entries(perStep).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  const gid = `pg-${gradientId}`;

  return (
    <div className="flex flex-col items-center gap-2 w-full min-w-0">
      <div className="text-center px-1">
        <p className="font-heading font-bold text-base text-white">{title}</p>
        <p className="text-xs text-emerald-100/55 leading-tight mt-0.5">{subtitle}</p>
        <p className="mt-1.5 text-sm font-semibold tabular-nums" style={{ color: accent }}>
          {peopleCount === 1 ? "1 pessoa" : `${peopleCount} pessoas`} no ciclo
        </p>
        {onSliceClick && (
          <p className="text-[10px] text-emerald-100/40 mt-0.5">
            Toque na fatia · nome, telefone e etapa
          </p>
        )}
      </div>

      <svg
        width={300}
        height={300}
        viewBox={`0 0 ${size} ${size}`}
        className="shrink-0 w-full max-w-[300px] h-auto drop-shadow-[0_0_28px_rgba(0,168,89,0.18)]"
        role="img"
        aria-label={title}
      >
        <defs>
          <radialGradient id={gid} cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor={accent} stopOpacity="0.35" />
            <stop offset="100%" stopColor={accent} stopOpacity="0" />
          </radialGradient>
        </defs>
        <circle cx={cx} cy={cy} r={r + 18} fill={`url(#${gid})`} />

        {steps.map((s, i) => {
          const a0 = (360 / n) * i + 1.2;
          const a1 = (360 / n) * (i + 1) - 1.2;
          const p1 = polar(cx, cy, r, a0);
          const p2 = polar(cx, cy, r, a1);
          const large = a1 - a0 > 180 ? 1 : 0;
          const count = perStep[s.id] || 0;
          const has = count > 0;
          const current = activeId === s.id && has;
          const tip = `${s.label} · ${count} ${count === 1 ? "pessoa" : "pessoas"} — ${s.hint}`;
          return (
            <path
              key={s.id}
              d={`M ${cx} ${cy} L ${p1.x} ${p1.y} A ${r} ${r} 0 ${large} 1 ${p2.x} ${p2.y} Z`}
              fill={has ? accent : "rgba(255,255,255,0.06)"}
              opacity={current ? 1 : has ? 0.72 : 0.35}
              className={cn(
                "transition-all duration-500",
                onSliceClick && "cursor-pointer hover:brightness-125",
              )}
              onClick={() => onSliceClick?.(s)}
              role={onSliceClick ? "button" : undefined}
              tabIndex={onSliceClick ? 0 : undefined}
              aria-label={tip}
              onKeyDown={(e) => {
                if (onSliceClick && (e.key === "Enter" || e.key === " ")) {
                  e.preventDefault();
                  onSliceClick(s);
                }
              }}
            >
              <title>{tip}</title>
            </path>
          );
        })}

        <circle cx={cx} cy={cy} r={hole} fill="#061a10" />
        <circle
          cx={cx}
          cy={cy}
          r={hole - 1}
          fill="none"
          stroke="rgba(0,168,89,0.25)"
          strokeWidth={1}
        />

        {steps.map((s, i) => {
          const ang = (360 / n) * i + 360 / n / 2;
          const p = polar(cx, cy, labelR, ang);
          const count = perStep[s.id] || 0;
          const has = count > 0;
          return (
            <g
              key={`l-${s.id}`}
              className={cn(onSliceClick && "cursor-pointer")}
              onClick={() => onSliceClick?.(s)}
            >
              <text
                x={p.x}
                y={p.y - 6}
                textAnchor="middle"
                fill={has ? "rgba(255,255,255,0.9)" : "rgba(255,255,255,0.35)"}
                style={{ fontSize: 10, fontWeight: 600 }}
              >
                {s.short}
              </text>
              <text
                x={p.x}
                y={p.y + 8}
                textAnchor="middle"
                fill={has ? accent : "rgba(255,255,255,0.25)"}
                style={{ fontSize: 11, fontWeight: 700, fontVariantNumeric: "tabular-nums" }}
              >
                {count}
              </text>
            </g>
          );
        })}

        <text
          x={cx}
          y={cy - 6}
          textAnchor="middle"
          fill="#fff"
          style={{ fontSize: 26, fontWeight: 800 }}
        >
          {peopleCount}
        </text>
        <text
          x={cx}
          y={cy + 14}
          textAnchor="middle"
          fill="rgba(167,243,208,0.55)"
          style={{ fontSize: 10, fontWeight: 600 }}
        >
          no ciclo
        </text>
      </svg>
    </div>
  );
}
