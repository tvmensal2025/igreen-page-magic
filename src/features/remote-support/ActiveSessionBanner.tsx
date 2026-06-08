import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { ScreenShare, X, Lock, ShieldAlert, Pause, Play, Clock } from "lucide-react";
import { Card } from "@/components/ui/card";
import type { SupportSession } from "./types";

interface Props {
  session: SupportSession;
  code: string | null;
  codeExpiresAt: number | null;
  sharing: boolean;
  paused: boolean;
  shareSurface?: string | null;
  onStartShare: () => void;
  onTogglePause: () => void;
  onEnd: () => void;
}

function fmtDuration(ms: number) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = String(m).padStart(2, "0");
  const ss = String(s).padStart(2, "0");
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

/** Banner fixo enquanto há uma sessão ativa/pending. Mostra o código rotativo, timer e ações. */
export function ActiveSessionBanner({
  session, code, codeExpiresAt, sharing, paused,
  onStartShare, onTogglePause, onEnd,
}: Props) {
  const [remaining, setRemaining] = useState(0);
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    if (!codeExpiresAt) return;
    const tick = () => setRemaining(Math.max(0, Math.ceil((codeExpiresAt - Date.now()) / 1000)));
    tick();
    const t = setInterval(tick, 500);
    return () => clearInterval(t);
  }, [codeExpiresAt]);

  useEffect(() => {
    const start = session.started_at ? new Date(session.started_at).getTime() : Date.now();
    const tick = () => setElapsed(Date.now() - start);
    tick();
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, [session.started_at]);

  return (
    <div
      data-remote-support-banner
      className="fixed top-0 inset-x-0 z-[9999] bg-destructive text-destructive-foreground shadow-lg border-b-2 border-destructive-foreground/30"
    >
      <div className="max-w-7xl mx-auto px-3 py-2 flex items-center gap-3 flex-wrap">
        <ShieldAlert className="size-5 shrink-0" />
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
              <b>Suporte ATIVO</b> — sua tela {sharing ? "está sendo compartilhada" : "não está sendo compartilhada ainda"}.
              {paused && <span className="ml-2 px-2 py-0.5 rounded bg-yellow-400 text-black text-xs font-semibold">CONTROLE PAUSADO</span>}
            </>
          )}
          {session.status === "requested" && <b>Aguardando o suporte aceitar seu pedido…</b>}
        </div>

        {session.status === "active" && (
          <div className="flex items-center gap-1 text-xs font-mono bg-black/20 px-2 py-1 rounded">
            <Clock className="size-3" /> {fmtDuration(elapsed)}
          </div>
        )}

        {session.status === "pending_code" && code && (
          <Card className="px-3 py-1 bg-background text-foreground flex items-center gap-2 font-mono">
            <Lock className="size-4 text-primary" />
            <span className="text-2xl tracking-[0.4em] font-bold select-all">{code}</span>
            <span className="text-xs text-muted-foreground">{remaining}s</span>
          </Card>
        )}

        {session.status === "active" && !sharing && (
          <Button size="sm" variant="secondary" onClick={onStartShare}>
            <ScreenShare className="size-4 mr-1" /> Compartilhar tela
          </Button>
        )}

        {session.status === "active" && sharing && (
          <Button
            size="sm"
            variant={paused ? "default" : "outline"}
            className={paused ? "" : "bg-background text-foreground"}
            onClick={onTogglePause}
            title="Pausa imediata do controle do suporte (kill switch)"
          >
            {paused ? <><Play className="size-4 mr-1" /> Retomar</> : <><Pause className="size-4 mr-1" /> Pausar controle</>}
          </Button>
        )}

        <Button size="sm" variant="outline" className="bg-background text-foreground" onClick={onEnd}>
          <X className="size-4 mr-1" /> Encerrar
        </Button>
      </div>
    </div>
  );
}
