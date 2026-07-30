import { Phone, Sparkles } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type {
  ClassifiedPartnerLead,
  PartnerCycleStep,
} from "@/lib/partnerPortalCycle";

/**
 * Detalhe da fatia A/B/C — modal centralizado (mobile e desktop).
 * Antes era Sheet bottom e ficava colado demais na base da tela.
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
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="dark w-[calc(100%-1.5rem)] max-w-lg max-h-[min(85dvh,720px)] overflow-y-auto rounded-2xl border-white/10 bg-[#071a10] p-5 text-foreground sm:p-6"
      >
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
            {people.map((p) => (
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
                <div className="mt-2.5 flex items-start gap-2 rounded-xl bg-emerald-500/10 border border-emerald-500/15 px-2.5 py-2">
                  <Sparkles className="h-3.5 w-3.5 text-emerald-400 mt-0.5 shrink-0" />
                  <div className="min-w-0">
                    <p className="text-xs text-emerald-100/90 leading-snug">
                      {p.stageNotice}
                    </p>
                    {p.nextHint && (
                      <p className="text-[11px] text-emerald-100/50 mt-1">
                        Próximo: {p.nextHint}
                      </p>
                    )}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </DialogContent>
    </Dialog>
  );
}
