import { useEffect, useState } from "react";
import { Phone } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { buildPartnerLeadCardText } from "@/lib/partnerPortalNextStep";
import type {
  ClassifiedPartnerLead,
  PartnerCycleStep,
} from "@/lib/partnerPortalCycle";
import { cn } from "@/lib/utils";

function useNowMs(tickMs = 15_000): number {
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNowMs(Date.now()), tickMs);
    return () => window.clearInterval(id);
  }, [tickMs]);
  return nowMs;
}

/**
 * Detalhe da fatia — linguagem simples para o parceiro leigo.
 */
export function PartnerPortalSliceSheet({
  open,
  onOpenChange,
  groupLabel,
  step,
  people,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  groupLabel: string;
  step: PartnerCycleStep | null;
  people: ClassifiedPartnerLead[];
}) {
  const nowMs = useNowMs();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="dark w-[calc(100%-1.5rem)] max-w-lg max-h-[min(85dvh,720px)] overflow-y-auto rounded-2xl border-white/10 bg-[#071a10] p-5 text-foreground sm:p-6">
        <DialogHeader className="text-left space-y-1.5 pr-6">
          <DialogTitle className="font-heading text-white text-lg">
            {step?.label ?? "Etapa"}
          </DialogTitle>
          <DialogDescription className="text-emerald-100/60 text-sm">
            {groupLabel}
            {step?.hint ? ` · ${step.hint}` : ""}
          </DialogDescription>
        </DialogHeader>

        {people.length === 0 ? (
          <p className="py-8 text-center text-sm text-emerald-100/50">
            Ninguém nesta fatia agora.
          </p>
        ) : (
          <ul className="space-y-2.5 pb-1 pt-2">
            {people.map((p) => {
              const card = buildPartnerLeadCardText({
                isHandoff: p.isHandoff,
                stageNotice: p.stageNotice,
                nextStepWhat: p.nextStepWhat,
                nextActionAt: p.nextActionAt,
                nowMs,
              });

              return (
                <li
                  key={p.id}
                  className="rounded-2xl border border-white/10 bg-white/[0.04] p-3.5"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-semibold text-white truncate">{p.displayName}</p>
                      {p.phoneTel ? (
                        <a
                          href={`tel:${p.phoneTel}`}
                          className="mt-1 inline-flex items-center gap-1.5 text-sm text-emerald-300 hover:text-emerald-200"
                        >
                          <Phone className="h-3.5 w-3.5 shrink-0" />
                          {p.phoneDisplay}
                        </a>
                      ) : (
                        <p className="mt-1 text-sm text-emerald-100/40">{p.phoneDisplay}</p>
                      )}
                    </div>
                  </div>

                  <div
                    className={cn(
                      "mt-2.5 rounded-xl border px-3 py-2.5 space-y-2",
                      p.isHandoff
                        ? "bg-sky-500/10 border-sky-500/20"
                        : "bg-emerald-500/10 border-emerald-500/15",
                    )}
                  >
                    <p className="text-sm text-white/95 leading-snug font-medium">
                      {card.nowLine}
                    </p>
                    <p className="text-xs text-emerald-100/80 leading-relaxed">
                      {card.nextLine}
                    </p>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </DialogContent>
    </Dialog>
  );
}
