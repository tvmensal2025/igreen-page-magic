// CtwaPreflightCard
// ─────────────────
// Card de pré-checagem antes de publicar anúncio Click-to-WhatsApp.
// Mostra os 4 checks (bot, Facebook, pixel, WABA) com ícones, mensagens
// claras e botão "Reverificar". Quando todos estão verdes, mostra um
// banner verde "Tudo pronto pra anunciar".
//
// O componente também exporta `ready` para o pai (wizard) bloquear o
// botão Publicar caso esteja faltando alguma coisa.

import { useEffect, useRef } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { CheckCircle2, XCircle, AlertTriangle, Loader2, RefreshCw, ExternalLink } from "lucide-react";
import { useCtwaPreflight, type CtwaCheck } from "@/hooks/useCtwaPreflight";

interface Props {
  consultantId: string | null;
  onReadyChange?: (ready: boolean) => void;
  compact?: boolean;
}

function StatusIcon({ status }: { status: CtwaCheck["status"] }) {
  if (status === "loading") return <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />;
  if (status === "ok") return <CheckCircle2 className="w-4 h-4 text-primary" />;
  if (status === "warn") return <AlertTriangle className="w-4 h-4 text-warning" />;
  return <XCircle className="w-4 h-4 text-destructive" />;
}

function CheckRow({ check }: { check: CtwaCheck }) {
  return (
    <div className="flex items-start gap-2 py-1.5">
      <div className="mt-0.5"><StatusIcon status={check.status} /></div>
      <div className="flex-1 min-w-0">
        <div className="text-sm text-foreground font-medium">{check.label}</div>
        {check.detail && <div className="text-xs text-muted-foreground">{check.detail}</div>}
        {check.hint && check.status !== "ok" && (
          <div className="text-xs text-muted-foreground mt-0.5">{check.hint}</div>
        )}
      </div>
    </div>
  );
}

export function CtwaPreflightCard({ consultantId, onReadyChange, compact }: Props) {
  const { loading, ready, bot, facebook, pixel, waba, refresh } = useCtwaPreflight(consultantId);

  // Notifica o pai sempre que `ready` mudar de valor.
  // Guardamos o callback num ref para NÃO depender da sua referência no
  // efeito — senão, um callback recriado a cada render do pai (ex.: arrow
  // inline) dispararia o efeito em loop infinito ("Maximum update depth").
  const onReadyChangeRef = useRef(onReadyChange);
  onReadyChangeRef.current = onReadyChange;
  useEffect(() => {
    onReadyChangeRef.current?.(ready);
  }, [ready]);

  return (
    <Card className={`p-4 border-2 ${ready ? "border-primary/40 bg-primary/5" : "border-warning/40 bg-warning/5"}`}>
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          {ready ? (
            <CheckCircle2 className="w-5 h-5 text-primary" />
          ) : (
            <AlertTriangle className="w-5 h-5 text-warning" />
          )}
          <div className="font-bold text-sm">
            {ready ? "Tudo pronto pra anunciar" : "Pré-checagem CTWA"}
          </div>
        </div>
        <Button size="sm" variant="ghost" onClick={refresh} disabled={loading} className="h-7 gap-1">
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
          {compact ? "" : "Reverificar"}
        </Button>
      </div>

      <div className="divide-y divide-border/40">
        <CheckRow check={bot} />
        <CheckRow check={facebook} />
        <CheckRow check={pixel} />
        <CheckRow check={waba} />
      </div>

      {!ready && !loading && (
        <div className="mt-3 pt-3 border-t border-border/40">
          <a
            href="https://business.facebook.com/wa/manage/phone-numbers/"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
          >
            <ExternalLink className="w-3 h-3" />
            Abrir Meta Business Suite (WhatsApp Business)
          </a>
        </div>
      )}
    </Card>
  );
}
