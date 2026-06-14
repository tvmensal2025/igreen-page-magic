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
}

export function OrcamentoButton({ consultantId, instanceName, isWhapi }: OrcamentoButtonProps) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-2 bg-[#7d9b76] hover:bg-[#1a2e1f] text-white px-5 py-2.5 rounded-none text-xs font-semibold tracking-[0.18em] uppercase shadow-sm transition-colors duration-300 self-start md:self-auto"
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
