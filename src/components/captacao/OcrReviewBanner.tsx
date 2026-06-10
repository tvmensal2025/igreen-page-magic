// Modal BLOCKING fullscreen que abre sozinho quando há OCR aguardando
// decisão do consultor (modo manual). Sobrepõe TUDO e o consultor é
// obrigado a clicar "Eu confirmo" ou "Pedir ao cliente" antes de fazer
// qualquer outra coisa.
//
// Regra de negócio (2026-05-28):
// - Modo automático (capture_mode='auto'): nunca aparece — bot manda
//   confirmação direto pro cliente sem passar pelo painel.
// - Modo manual (capture_mode='manual'): só dispara quando o consultor
//   está enviando 1-a-1. Modal trava a tela até decidir.
// - Timer de 60s visível: se consultor não decidir, cron libera
//   automaticamente para "pedir ao cliente" — lead nunca fica esperando.

import { useEffect } from "react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { useOcrReviewQueue } from "@/hooks/useOcrReviewQueue";
import { useCaptureSession } from "@/hooks/useCaptureSession";
import { OcrReviewCard } from "./OcrReviewCard";

interface Props {
  consultantId: string | null;
}

export function OcrReviewBanner({ consultantId }: Props) {
  const { items, refresh } = useOcrReviewQueue(consultantId);

  // Beep sonoro quando entra um novo OCR — chama atenção do consultor
  // mesmo em outra aba.
  useEffect(() => {
    if (items.length === 0) return;
    try {
      const audio = new Audio(
        "data:audio/wav;base64,UklGRl9vT19XQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQBvT19f"
      );
      audio.volume = 0.3;
      void audio.play().catch(() => {});
    } catch {}
  }, [items.length]);

  if (!consultantId || items.length === 0) return null;

  // Pega o lead mais antigo — modal trava aqui até o consultor decidir.
  const oldest = items[0];

  return (
    <Dialog open onOpenChange={() => { /* não-fechável: consultor PRECISA decidir */ }}>
      <DialogContent
        className="max-w-4xl p-0 gap-0 overflow-hidden"
        onEscapeKeyDown={(e) => e.preventDefault()}
        onPointerDownOutside={(e) => e.preventDefault()}
        onInteractOutside={(e) => e.preventDefault()}
      >
        <OcrReviewCardWrapper
          customerId={oldest.customer_id}
          onDecided={() => { void refresh(); }}
          queueLength={items.length}
        />
      </DialogContent>
    </Dialog>
  );
}

function OcrReviewCardWrapper({
  customerId, onDecided, queueLength,
}: {
  customerId: string;
  onDecided: () => void;
  queueLength: number;
}) {
  const { customer } = useCaptureSession(customerId);
  if (!customer) return <div className="p-12 text-center text-sm text-muted-foreground">Carregando dados da leitura automática…</div>;
  const kind = (customer as any).ocr_review_pending as "bill" | "doc" | null;
  if (!kind) {
    // Já foi tratado por outro caminho — fecha modal automaticamente.
    setTimeout(onDecided, 200);
    return <div className="p-8 text-center text-sm text-muted-foreground">Atualizando…</div>;
  }
  return (
    <div className="p-2">
      {queueLength > 1 && (
        <div className="mb-2 px-3 py-1 rounded bg-warning/15 border border-warning/40 text-warning dark:text-warning text-xs font-bold text-center">
          ⚠️ {queueLength} leads aguardando revisão. Decida este para liberar o próximo.
        </div>
      )}
      <OcrReviewCard customer={customer} kind={kind} onDecided={onDecided} />
    </div>
  );
}
