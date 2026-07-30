import { Phone, Sparkles } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import type {
  ClassifiedPartnerLead,
  PartnerCycleStep,
} from "@/lib/partnerPortalCycle";

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
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        className="dark max-h-[85dvh] overflow-y-auto rounded-t-3xl border-white/10 bg-[#071a10] text-foreground sm:max-w-lg sm:left-1/2 sm:-translate-x-1/2"
      >
        <SheetHeader className="text-left pb-2">
          <SheetTitle className="font-heading text-white">
            {step?.label ?? "Etapa"}
          </SheetTitle>
          <SheetDescription className="text-emerald-100/60">
            {groupLabel}
            {step?.hint ? ` · ${step.hint}` : ""}
          </SheetDescription>
        </SheetHeader>

        {people.length === 0 ? (
          <p className="py-8 text-center text-sm text-emerald-100/50">
            Ninguém nesta fatia agora.
          </p>
        ) : (
          <ul className="space-y-2.5 pb-6 pt-2">
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
      </SheetContent>
    </Sheet>
  );
}
