import { useMemo, useState } from "react";
import { motion } from "framer-motion";
import {
  countBySlice,
  leadsInSlice,
  stepsForGroup,
  type ClassifiedPartnerLead,
  type PartnerCycleGroup,
  type PartnerCycleStep,
} from "@/lib/partnerPortalCycle";
import { PartnerPortalPizzaRing } from "./PartnerPortalPizzaRing";
import { PartnerPortalSliceSheet } from "./PartnerPortalSliceSheet";

const GROUPS: Array<{
  group: PartnerCycleGroup;
  title: string;
  subtitle: string;
  accent: string;
}> = [
  {
    group: "A",
    title: "Em conversa (A)",
    subtitle: "Leads novos — WhatsApp, SMS e ligação",
    accent: "#00C853",
  },
  {
    group: "B",
    title: "Quem esfriou (B)",
    subtitle: "Onda de reengajamento (~10 dias)",
    accent: "#26A69A",
  },
  {
    group: "C",
    title: "Recall (C)",
    subtitle: "Retornos longos até ~1 ano",
    accent: "#66BB6A",
  },
];

export function PartnerPortalCycleSection({
  leads,
}: {
  leads: ClassifiedPartnerLead[];
}) {
  const [pick, setPick] = useState<{
    group: PartnerCycleGroup;
    step: PartnerCycleStep;
  } | null>(null);

  const people = useMemo(() => {
    if (!pick) return [];
    return leadsInSlice(leads, pick.group, pick.step.id);
  }, [leads, pick]);

  const groupLabel = pick
    ? GROUPS.find((g) => g.group === pick.group)?.title ?? pick.group
    : "";

  return (
    <section className="max-w-6xl mx-auto px-4 sm:px-6 py-8 sm:py-10">
      <div className="text-center mb-6 sm:mb-8">
        <h2 className="font-heading text-xl sm:text-2xl font-bold text-white">
          Ciclo dos seus leads
        </h2>
        <p className="text-sm text-emerald-100/55 mt-1.5 max-w-lg mx-auto">
          Mesmo modelo do consultor: conversa → quem esfriou → recalls (Zap, SMS
          e ligação) ao longo de ~1 ano.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 md:gap-4">
        {GROUPS.map((g, i) => {
          const steps = stepsForGroup(g.group);
          const perStep = countBySlice(leads, g.group);
          const peopleCount = leads.filter((l) => l.group === g.group).length;
          return (
            <motion.div
              key={g.group}
              initial={{ opacity: 0, scale: 0.94 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: 0.12 + i * 0.1, duration: 0.5 }}
              className="rounded-3xl border border-white/10 bg-white/[0.03] backdrop-blur-md p-4 sm:p-5"
            >
              <PartnerPortalPizzaRing
                title={g.title}
                subtitle={g.subtitle}
                steps={steps}
                perStep={perStep}
                peopleCount={peopleCount}
                accent={g.accent}
                gradientId={g.group}
                onSliceClick={(step) => setPick({ group: g.group, step })}
              />
            </motion.div>
          );
        })}
      </div>

      <PartnerPortalSliceSheet
        open={!!pick}
        onOpenChange={(v) => {
          if (!v) setPick(null);
        }}
        groupLabel={groupLabel}
        step={pick?.step ?? null}
        people={people}
      />
    </section>
  );
}
