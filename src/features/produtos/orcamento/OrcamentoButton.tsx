// =============================================================================
// Orçamento — Botão da topbar
// =============================================================================
// Botão aditivo que vai no slot `extra` da AppTopbar (hoje vazio). Abre o
// OrcamentoBuilderSheet sem tocar no layout nem nas demais abas. Aparece em
// qualquer aba do painel — montar orçamento é uma ação global do consultor.
// =============================================================================

import { useState } from "react";
import { FileText } from "lucide-react";
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
        className="inline-flex items-center gap-1.5 h-9 px-3 rounded-lg text-xs font-semibold transition-all"
        style={{
          background: "var(--pe-accent-glow)",
          border: "1px solid rgba(16,185,129,0.25)",
          color: "var(--pe-emerald-strong)",
        }}
        aria-label="Novo orçamento"
        title="Criar novo orçamento"
      >
        <FileText className="w-4 h-4" />
        <span className="hidden sm:inline">Orçamento</span>
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
