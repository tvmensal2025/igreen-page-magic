import { motion } from "framer-motion";
import { MessageCircle, QrCode, Snowflake, Users, Orbit } from "lucide-react";

type Kpi = {
  label: string;
  value: number;
  hint?: string;
  Icon: typeof QrCode;
  accent: string;
};

export function PartnerPortalKpis({
  leituras,
  leads,
  countA,
  countB,
  countC,
}: {
  leituras: number;
  leads: number;
  countA: number;
  countB: number;
  countC: number;
}) {
  const items: Kpi[] = [
    {
      label: "Leituras QR",
      value: leituras,
      Icon: QrCode,
      accent: "from-emerald-500/20 to-transparent",
    },
    {
      label: "Leads",
      value: leads,
      Icon: Users,
      accent: "from-lime-500/20 to-transparent",
    },
    {
      label: "Em conversa (A)",
      value: countA,
      hint: "Leads novos",
      Icon: MessageCircle,
      accent: "from-teal-500/25 to-transparent",
    },
    {
      label: "Quem esfriou (B)",
      value: countB,
      Icon: Snowflake,
      accent: "from-cyan-500/20 to-transparent",
    },
    {
      label: "Recall (C)",
      value: countC,
      hint: "Retornos longos",
      Icon: Orbit,
      accent: "from-green-600/25 to-transparent",
    },
  ];

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6">
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2.5 sm:gap-3">
        {items.map((item, i) => (
          <motion.div
            key={item.label}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.08 * i, duration: 0.45 }}
            className={`relative overflow-hidden rounded-2xl border border-white/10 bg-white/[0.04] backdrop-blur-sm p-3.5 sm:p-4 bg-gradient-to-br ${item.accent}`}
          >
            <div className="flex items-center gap-1.5 text-[10px] sm:text-[11px] uppercase tracking-wide text-emerald-100/60 font-medium">
              <item.Icon className="h-3.5 w-3.5 text-emerald-400/80" />
              <span className="truncate">{item.label}</span>
            </div>
            <p className="mt-2 font-heading text-2xl sm:text-3xl font-bold tabular-nums text-white">
              {item.value}
            </p>
            {item.hint && (
              <p className="text-[10px] text-emerald-100/45 mt-0.5">{item.hint}</p>
            )}
          </motion.div>
        ))}
      </div>
    </div>
  );
}
