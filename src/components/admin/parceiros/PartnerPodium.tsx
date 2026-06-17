// =============================================================================
// Pódio Top 3 Parceiros — destaca os 3 que mais geraram indicações nos últimos
// 30 dias. Visual de palco (ouro, prata, bronze) para gamificar a indicação.
// =============================================================================

import { Trophy, Medal, Award } from "lucide-react";
import type { ReferralPartner } from "./hooks/useReferralPartners";
import type { PartnerAnalytics } from "./hooks/usePartnerAnalytics";

interface Props {
  partners: ReferralPartner[];
  analytics: PartnerAnalytics[];
}

interface PodiumEntry {
  name: string;
  count: number;
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export function PartnerPodium({ partners, analytics }: Props) {
  const ranked: PodiumEntry[] = partners
    .map((p) => {
      const a = analytics.find((x) => x.partner_id === p.id);
      return { name: p.nome, count: a?.leads_30d ?? 0 };
    })
    .filter((e) => e.count > 0)
    .sort((a, b) => b.count - a.count)
    .slice(0, 3);

  if (ranked.length === 0) return null;

  // Ordem visual no palco: [2º, 1º, 3º] para o 1º ficar no centro.
  const stage: (PodiumEntry | null)[] = [
    ranked[1] ?? null,
    ranked[0] ?? null,
    ranked[2] ?? null,
  ];
  const positions = [2, 1, 3] as const;

  const cfg = {
    1: {
      height: "h-44 sm:h-52",
      gradient: "from-amber-400 via-yellow-300 to-amber-500",
      ring: "ring-amber-300",
      shadow: "shadow-[0_-12px_40px_-8px_rgba(245,158,11,0.55)]",
      icon: Trophy,
      iconClass: "text-amber-100",
      label: "1º",
      tag: "Top 1",
    },
    2: {
      height: "h-32 sm:h-40",
      gradient: "from-slate-300 via-slate-200 to-slate-400",
      ring: "ring-slate-300",
      shadow: "shadow-[0_-8px_30px_-8px_rgba(148,163,184,0.5)]",
      icon: Medal,
      iconClass: "text-slate-100",
      label: "2º",
      tag: "Top 2",
    },
    3: {
      height: "h-24 sm:h-32",
      gradient: "from-orange-400 via-amber-600 to-orange-700",
      ring: "ring-orange-400",
      shadow: "shadow-[0_-8px_30px_-8px_rgba(234,88,12,0.45)]",
      icon: Award,
      iconClass: "text-orange-100",
      label: "3º",
      tag: "Top 3",
    },
  } as const;

  return (
    <div className="relative overflow-hidden rounded-2xl border border-amber-200/40 bg-gradient-to-br from-amber-50/60 via-card to-card p-5 sm:p-7">
      <div className="absolute inset-0 pointer-events-none opacity-30 bg-[radial-gradient(circle_at_50%_-20%,hsl(45_90%_60%/0.4),transparent_60%)]" />

      <div className="relative flex items-center justify-between mb-5">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-amber-700/80">
            Quem mais indica
          </p>
          <h3 className="text-lg font-bold text-foreground flex items-center gap-2">
            <Trophy className="w-5 h-5 text-amber-500" />
            Pódio dos parceiros · últimos 30 dias
          </h3>
        </div>
      </div>

      <div className="relative grid grid-cols-3 items-end gap-2 sm:gap-4">
        {stage.map((entry, idx) => {
          const pos = positions[idx];
          const c = cfg[pos];
          if (!entry) {
            return (
              <div key={`empty-${idx}`} className="flex flex-col items-center gap-2 opacity-30">
                <div className={`w-14 h-14 rounded-full bg-muted ring-2 ring-border`} />
                <div className={`w-full ${c.height} rounded-t-xl bg-muted/40 flex items-end justify-center pb-2`}>
                  <span className="text-xs text-muted-foreground font-semibold">{c.label}</span>
                </div>
              </div>
            );
          }
          const Icon = c.icon;
          return (
            <div key={`${entry.name}-${pos}`} className="flex flex-col items-center gap-2 animate-in fade-in slide-in-from-bottom-4 duration-700">
              <div className={`relative w-14 h-14 sm:w-16 sm:h-16 rounded-full bg-gradient-to-br ${c.gradient} flex items-center justify-center font-bold text-white text-sm sm:text-base ring-4 ${c.ring} ${c.shadow}`}>
                <span className="drop-shadow">{initials(entry.name)}</span>
                <Icon className={`absolute -top-2 -right-2 w-6 h-6 ${c.iconClass} drop-shadow-lg`} />
              </div>
              <p className="text-[11px] sm:text-xs font-semibold text-foreground text-center max-w-[110px] truncate" title={entry.name}>
                {entry.name}
              </p>
              <div className={`relative w-full ${c.height} rounded-t-xl bg-gradient-to-b ${c.gradient} ${c.shadow} flex flex-col items-center justify-start pt-3`}>
                <span className="text-white text-lg sm:text-xl font-extrabold drop-shadow">{c.label}</span>
                <span className="text-[10px] sm:text-xs text-white/90 font-medium mt-1">{entry.count} indic.</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
