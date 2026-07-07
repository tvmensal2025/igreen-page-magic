// =============================================================================
// Remote Support — ActiveSessionBanner (lado do consultor)
// =============================================================================
// Banner fixo no topo da tela enquanto há uma sessão ativa ou pendente.
// v4: adiciona indicador de reconexão automática em andamento.
// =============================================================================

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { ScreenShare, X, Lock, ShieldAlert, Pause, Play, Clock, RefreshCw } from "lucide-react";

import { Card } from "@/components/ui/card";
import type { SupportSession } from "./types";

interface Props {
  session: SupportSession;
  code: string | null;
  codeExpiresAt: number | null;
  sharing: boolean;
  paused: boolean;
  /** true enquanto uma reconexão automática está em andamento */
  reconnecting?: boolean;
  shareSurface?: string | null;
  onStartShare: () => void;
  onTogglePause: () => void;
  onEnd: () => void;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fmtDuration(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1_000));
  const h  = Math.floor(total / 3_600);
  const m  = Math.floor((total % 3_600) / 60);
  const s  = total % 60;
  const mm = String(m).padStart(2, "0");
  const ss = String(s).padStart(2, "0");
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

// ---------------------------------------------------------------------------
// Componente
// ---------------------------------------------------------------------------

export function ActiveSessionBanner({
  session,
  code,
  codeExpiresAt,
  sharing,
  paused,
  reconnecting = false,
  shareSurface,
  onStartShare,
  onTogglePause,
  onEnd,
}: Props) {
  const [remaining, setRemaining] = useState(0);
  const [elapsed,   setElapsed]   = useState(0);

  // Contador regressivo do código
  useEffect(() => {
    if (!codeExpiresAt) return;
    const tick = () =>
      setRemaining(Math.max(0, Math.ceil((codeExpiresAt - Date.now()) / 1_000)));
    tick();
    const t = setInterval(tick, 500);
    return () => clearInterval(t);
  }, [codeExpiresAt]);

  // Cronômetro da sessão ativa
  useEffect(() => {
    const start = session.started_at
      ? new Date(session.started_at).getTime()
      : Date.now();
    const tick = () => setElapsed(Date.now() - start);
    tick();
    const t = setInterval(tick, 1_000);
    return () => clearInterval(t);
  }, [session.started_at]);

  return (
    <div
      data-remote-support-banner
      className="fixed top-0 inset-x-0 z-[9999] bg-destructive text-destructive-foreground shadow-lg border-b-2 border-destructive-foreground/30"
    >
      <div className="max-w-7xl mx-auto px-3 py-2 flex items-center gap-3 flex-wrap">
        <ShieldAlert className="size-5 shrink-0" aria-hidden="true" />

        {/* Mensagem principal */}
        <div className="flex-1 min-w-[200px] text-sm">
          {session.status === "pending_code" && (
            <>
              <b>Suporte aguardando código.</b>{" "}
              <span className="opacity-90">
                Leia o código abaixo para o suporte por telefone/WhatsApp.
              </span>
            </>
          )}

          {session.status === "active" && (
            <>
              <b>Suporte ATIVO</b>
              {" — "}
              {reconnecting ? (
                <span className="inline-flex items-center gap-1">
                  <RefreshCw className="size-3 animate-spin" aria-hidden="true" />
                  Reconectando compartilhamento…
                </span>
              ) : sharing ? (
                "sua tela está sendo compartilhada"
              ) : (
                "sua tela não está sendo compartilhada ainda"
              )}

              {paused && (
                <span className="ml-2 px-2 py-0.5 rounded bg-warning text-black text-xs font-semibold">
                  CONTROLE PAUSADO
                </span>
              )}

              {sharing && shareSurface && shareSurface !== "browser" && (
                <span className="ml-2 px-2 py-0.5 rounded bg-warning text-black text-xs font-semibold">
                  {shareSurface === "monitor" ? "Tela inteira" : "Janela"} compartilhada —
                  cliques podem errar. Prefira compartilhar a aba.
                </span>
              )}
            </>
          )}

          {session.status === "requested" && (
            <b>Aguardando o suporte aceitar seu pedido…</b>
          )}
        </div>

        {/* Cronômetro */}
        {session.status === "active" && (
          <div
            className="flex items-center gap-1 text-xs font-mono bg-black/20 px-2 py-1 rounded"
            title="Duração da sessão"
          >
            <Clock className="size-3" aria-hidden="true" />
            {fmtDuration(elapsed)}
          </div>
        )}

        {/* Card do código rotativo */}
        {session.status === "pending_code" && code && (
          <Card className="px-3 py-1 bg-background text-foreground flex items-center gap-2 font-mono">
            <Lock className="size-4 text-primary" aria-hidden="true" />
            <span
              className="text-2xl tracking-[0.4em] font-bold select-all"
              aria-label={`Código de acesso: ${code.split("").join(" ")}`}
            >
              {code}
            </span>
            <span className="text-xs text-muted-foreground">{remaining}s</span>
          </Card>
        )}

        {/* Botão compartilhar — aparece se não está sharing E não está reconectando */}
        {session.status === "active" && !sharing && !reconnecting && (
          <Button size="sm" variant="secondary" onClick={onStartShare}>
            <ScreenShare className="size-4 mr-1" aria-hidden="true" />
            Compartilhar tela
          </Button>
        )}

        {/* Spinner durante reconexão automática */}
        {session.status === "active" && reconnecting && (
          <div className="flex items-center gap-1.5 text-xs px-2 py-1 rounded bg-black/20">
            <RefreshCw className="size-3 animate-spin" aria-hidden="true" />
            Reconectando…
          </div>
        )}

        {/* Botão pausar/retomar */}
        {session.status === "active" && sharing && !reconnecting && (
          <Button
            size="sm"
            variant={paused ? "default" : "outline"}
            className={paused ? "" : "bg-background text-foreground"}
            onClick={onTogglePause}
            title="Pausa imediata do controle remoto (kill switch)"
          >
            {paused ? (
              <><Play className="size-4 mr-1" aria-hidden="true" /> Retomar</>
            ) : (
              <><Pause className="size-4 mr-1" aria-hidden="true" /> Pausar controle</>
            )}
          </Button>
        )}

        {/* Encerrar */}
        <Button
          size="sm"
          variant="outline"
          className="bg-background text-foreground"
          onClick={onEnd}
        >
          <X className="size-4 mr-1" aria-hidden="true" /> Encerrar
        </Button>
      </div>
    </div>
  );
}
