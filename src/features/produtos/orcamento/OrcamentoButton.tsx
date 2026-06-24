// =============================================================================
// Orçamento — Botão da topbar (Sage CTA editorial)
// =============================================================================

import { useState } from "react";
import { Plus } from "lucide-react";
import { OrcamentoBuilderSheet } from "./OrcamentoBuilderSheet";

interface OrcamentoButtonProps {
  consultantId: string;
  instanceName?: string | null;
  isWhapi?: boolean;
  className?: string;
}

export function OrcamentoButton({ consultantId, instanceName, isWhapi, className }: OrcamentoButtonProps) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={`inline-flex items-center justify-center gap-2 bg-pv-accent hover:bg-pv-ink text-white px-5 py-2.5 rounded-none text-xs font-semibold tracking-[0.18em] uppercase shadow-sm transition-colors duration-300 self-start md:self-auto ${className ?? ""}`}
        aria-label="Novo orçamento"
      >
        <span>Novo orçamento</span>
        <Plus className="w-4 h-4" />
      </button>

      <OrcamentoBuilderSheet
        consultantId={consultantId}
        instanceName={instanceName}
        isWhapi={isWhapi}
        open={open}
        onOpenChange={setOpen}
      />
    </>
  );
}
