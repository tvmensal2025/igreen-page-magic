// =============================================================================
// SuperAdminRemoteSupport — página de suporte remoto do operador (Super Admin)
// =============================================================================
// Correções v3:
//   - RemoteControlOverlay: foco automático ao montar + toNorm com DPR correto.
//   - Wheel: envia deltaMode para o consultor normalizar corretamente.
//   - viewportInfo: operador armazena e usa para mapear coords com DPR preciso.
//   - Cursor virtual visível desde o mount (opacity: 1 inicial).
//   - Aviso explícito quando displaySurface !== "browser".
// =============================================================================

import { useEffect, useRef, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAdminAuth } from "@/hooks/useAdminAuth";
import { useUserRole } from "@/hooks/useUserRole";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  ArrowLeft, ShieldAlert, Check, X, Eye, Send, Play, Square, Loader2,
  Maximize2, Minimize2, Camera, Copy, Activity, MousePointer2, KeyboardIcon,
  AlertTriangle,
} from "lucide-react";
import { toast } from "sonner";
import type {
  SupportSession, RemoteCommand, CommandResult, RequesterViewport,
} from "@/features/remote-support/types";
import { acceptSession, endSession, operatorRequest, verifyCode } from "@/features/remote-support/api";
import {
  createOperatorPeer, getInboundVideoFps,
  type RtcStage, type QualityLevel,
} from "@/features/remote-support/screenShare";

// ---------------------------------------------------------------------------
// Tipos locais
// ---------------------------------------------------------------------------

interface ConsultantRow { id: string; name: string; license: string }

// ---------------------------------------------------------------------------
// Preferências persistidas
// ---------------------------------------------------------------------------

const PREFS_KEY = "remote_support_prefs_v3";
type Prefs = { control: boolean; quality: QualityLevel; sidePanel: boolean };

function loadPrefs(): Prefs {
  try {
    const raw = JSON.parse(localStorage.getItem(PREFS_KEY) ?? "{}") as Partial<Prefs>;
    return {
      control:   raw.control   !== false,           // padrão: ativado
      quality:   raw.quality   ?? "auto",
      sidePanel: raw.sidePanel !== false,
    };
  } catch {
    return { control: true, quality: "auto", sidePanel: true };
  }
}

function savePrefs(p: Prefs) {
  try { localStorage.setItem(PREFS_KEY, JSON.stringify(p)); } catch { /* ignora */ }
}

// ---------------------------------------------------------------------------
// Página principal
// ---------------------------------------------------------------------------

export default function SuperAdminRemoteSupport() {
  const navigate = useNavigate();
  const { userId, loading: authLoading } = useAdminAuth();
  const { isSuperAdmin, loading: roleLoading } = useUserRole(userId);

  const [pending,       setPending]       = useState<SupportSession[]>([]);
  const [active,        setActive]        = useState<SupportSession[]>([]);
  const [consultants,   setConsultants]   = useState<ConsultantRow[]>([]);
  const [pickConsultant, setPickConsultant] = useState("");
  const [selectedSession, setSelectedSession] = useState<SupportSession | null>(null);

  // -------------------------------------------------------------------------
  // Carrega fila + ouve mudanças em tempo real
  // -------------------------------------------------------------------------
  useEffect(() => {
    if (!isSuperAdmin) return;

    supabase
      .from("consultants")
      .select("id, name, license")
      .order("name")
      .then(({ data }) => setConsultants((data ?? []) as ConsultantRow[]));

    void refresh();

    const ch = supabase
      .channel("super:support:sessions")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "remote_support_sessions" },
        () => { void refresh(); },
      )
      .subscribe();

    return () => { supabase.removeChannel(ch); };
  }, [isSuperAdmin]);

  const refresh = async () => {
    const { data } = await supabase
      .from("remote_support_sessions" as "remote_support_sessions")
      .select("*")
      .in("status", ["requested", "pending_code", "active"])
      .order("created_at", { ascending: false });

    const all = (data ?? []) as unknown as SupportSession[];
    setPending(all.filter(s => s.status === "requested" || s.status === "pending_code"));
    setActive(all.filter(s => s.status === "active"));
  };

  const consultantName = (id: string | null) =>
    (id && consultants.find(c => c.id === id)?.name) ?? id?.slice(0, 8) ?? "—";

  // -------------------------------------------------------------------------
  // Renderização
  // -------------------------------------------------------------------------

  if (authLoading || roleLoading) {
    return (
      <div className="p-8 flex items-center gap-2 text-muted-foreground">
        <Loader2 className="animate-spin size-5" /> Verificando permissões…
      </div>
    );
  }

  if (!isSuperAdmin) {
    return (
      <div className="p-8 text-center space-y-3">
        <ShieldAlert className="size-10 mx-auto text-destructive" />
        <h1 className="text-xl font-bold">Acesso restrito</h1>
        <p className="text-muted-foreground">Apenas o Super Admin pode acessar o Suporte Remoto.</p>
        <Button onClick={() => navigate("/admin")}>Voltar ao painel</Button>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background p-4">
      <div className="max-w-7xl mx-auto space-y-4">

        <header className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="sm" onClick={() => navigate("/super-admin")}>
              <ArrowLeft className="size-4 mr-1" /> Voltar
            </Button>
            <div>
              <h1 className="text-2xl font-bold">Suporte Remoto</h1>
              <p className="text-sm text-muted-foreground">Atenda pedidos ou inicie uma sessão.</p>
            </div>
          </div>
        </header>

        <Tabs defaultValue="queue">
          <TabsList>
            <TabsTrigger value="queue">Fila ({pending.length})</TabsTrigger>
            <TabsTrigger value="active">Ativas ({active.length})</TabsTrigger>
            <TabsTrigger value="start">Iniciar sessão</TabsTrigger>
            <TabsTrigger value="history">Histórico</TabsTrigger>
          </TabsList>

          {/* Fila */}
          <TabsContent value="queue" className="space-y-2">
            {pending.length === 0 && (
              <Card>
                <CardContent className="p-6 text-center text-muted-foreground">
                  Nenhum pedido na fila.
                </CardContent>
              </Card>
            )}
            {pending.map(s => (
              <Card key={s.id}>
                <CardContent className="p-4 flex items-center gap-3">
                  <Badge variant={s.status === "pending_code" ? "default" : "secondary"}>
                    {s.status === "pending_code" ? "Aguardando código" : "Novo pedido"}
                  </Badge>
                  <div className="flex-1 min-w-0">
                    <div className="font-medium truncate">{consultantName(s.requester_id)}</div>
                    <div className="text-xs text-muted-foreground">
                      {new Date(s.created_at).toLocaleString()} · por: {s.initiated_by}
                    </div>
                  </div>
                  {s.status === "requested" ? (
                    <Button size="sm" onClick={async () => {
                      try {
                        await acceptSession(s.id);
                        toast.success("Código enviado ao consultor");
                      } catch (e) {
                        toast.error(e instanceof Error ? e.message : "Erro ao aceitar");
                      }
                    }}>
                      <Check className="size-4 mr-1" /> Aceitar
                    </Button>
                  ) : (
                    <Button size="sm" onClick={() => setSelectedSession(s)}>
                      <Send className="size-4 mr-1" /> Digitar código
                    </Button>
                  )}
                  <Button
                    size="sm" variant="ghost"
                    onClick={() => endSession(s.id, "operator_cancelled")}
                    title="Cancelar pedido"
                  >
                    <X className="size-4" />
                  </Button>
                </CardContent>
              </Card>
            ))}
          </TabsContent>

          {/* Sessões ativas */}
          <TabsContent value="active" className="space-y-2">
            {active.length === 0 && (
              <Card>
                <CardContent className="p-6 text-center text-muted-foreground">
                  Nenhuma sessão ativa.
                </CardContent>
              </Card>
            )}
            {active.map(s => (
              <Card key={s.id}>
                <CardContent className="p-4 flex items-center gap-3">
                  <Badge className="bg-green-600 text-white">ATIVA</Badge>
                  <div className="flex-1 min-w-0">
                    <div className="font-medium truncate">{consultantName(s.requester_id)}</div>
                    <div className="text-xs text-muted-foreground">
                      desde {s.started_at ? new Date(s.started_at).toLocaleTimeString() : "—"}
                    </div>
                  </div>
                  <Button size="sm" onClick={() => setSelectedSession(s)}>
                    <Eye className="size-4 mr-1" /> Abrir
                  </Button>
                  <Button
                    size="sm" variant="destructive"
                    onClick={() => endSession(s.id, "operator_ended")}
                    title="Encerrar sessão"
                  >
                    <Square className="size-4" />
                  </Button>
                </CardContent>
              </Card>
            ))}
          </TabsContent>

          {/* Iniciar sessão */}
          <TabsContent value="start">
            <Card>
              <CardHeader>
                <CardTitle>Solicitar acesso a um consultor</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <select
                  className="w-full border rounded-md p-2 bg-background text-sm"
                  value={pickConsultant}
                  onChange={e => setPickConsultant(e.target.value)}
                >
                  <option value="">Selecione um consultor…</option>
                  {consultants.map(c => (
                    <option key={c.id} value={c.id}>{c.name} ({c.license})</option>
                  ))}
                </select>
                <Button
                  disabled={!pickConsultant}
                  onClick={async () => {
                    try {
                      const s = await operatorRequest(pickConsultant);
                      toast.success("Pedido enviado. Aguardando o consultor autorizar.");
                      setSelectedSession(s);
                    } catch (e) {
                      toast.error(e instanceof Error ? e.message : "Erro ao solicitar");
                    }
                  }}
                >
                  <Play className="size-4 mr-1" /> Solicitar acesso
                </Button>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Histórico */}
          <TabsContent value="history">
            <HistoryView consultants={consultants} />
          </TabsContent>
        </Tabs>
      </div>

      {selectedSession && (
        <SessionWorkbench
          session={selectedSession}
          consultantName={consultantName(selectedSession.requester_id)}
          onClose={() => setSelectedSession(null)}
        />
      )}
    </div>
  );
}

// =============================================================================
// SessionWorkbench — player de vídeo + canal de comandos
// =============================================================================

function SessionWorkbench({
  session, consultantName, onClose,
}: {
  session: SupportSession;
  consultantName: string;
  onClose: () => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const videoRef     = useRef<HTMLVideoElement>(null);

  const [codeInput,  setCodeInput]  = useState("");
  const [verifying,  setVerifying]  = useState(false);
  const [status,     setStatus]     = useState(session.status);

  const peerRef    = useRef<Awaited<ReturnType<typeof createOperatorPeer>> | null>(null);
  const dcRef      = useRef<RTCDataChannel | null>(null);
  const pendingRef = useRef<Map<string, (r: CommandResult) => void>>(new Map());

  const [logs,      setLogs]      = useState<{ id: string; text: string; ok?: boolean }[]>([]);
  const [stage,     setStage]     = useState<RtcStage>("idle");
  const [hasStream, setHasStream] = useState(false);
  const [navUrl,    setNavUrl]    = useState("");
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [rtt,  setRtt]  = useState<number | null>(null);
  const [fps,  setFps]  = useState<number | null>(null);
  const [paused,     setPaused]     = useState(false);
  const [confirmEnd, setConfirmEnd] = useState(false);
  const [videoReady, setVideoReady] = useState(false);

  // Viewport do consultor — recebido via viewportInfo ao conectar
  const [requesterVp, setRequesterVp] = useState<RequesterViewport | null>(null);

  const initialPrefs = useRef(loadPrefs()).current;
  const [controlEnabled, setControlEnabled] = useState(initialPrefs.control);
  const [quality,        setQuality]        = useState<QualityLevel>(initialPrefs.quality);
  const [sidePanel,      setSidePanel]      = useState(initialPrefs.sidePanel);

  useEffect(() => {
    savePrefs({ control: controlEnabled, quality, sidePanel });
  }, [controlEnabled, quality, sidePanel]);

  // -------------------------------------------------------------------------
  // Log
  // -------------------------------------------------------------------------
  const pushLog = useCallback((text: string, ok?: boolean) => {
    setLogs(l => [{ id: crypto.randomUUID(), text, ok }, ...l].slice(0, 100));
  }, []);

  // -------------------------------------------------------------------------
  // Envio de comandos via DataChannel
  // -------------------------------------------------------------------------
  const sendCmd = useCallback((cmd: Omit<RemoteCommand, "id">) => {
    const dc = dcRef.current;
    if (!dc || dc.readyState !== "open") {
      if (cmd.kind !== "mouseMove" && cmd.kind !== "wheel" && cmd.kind !== "ping") {
        console.warn("[remote-support][send] dropped — channel not open:", cmd.kind, dc?.readyState);
      }
      return undefined;
    }

    const full: RemoteCommand = { ...cmd, id: crypto.randomUUID() };

    if (cmd.kind !== "mouseMove" && cmd.kind !== "wheel" && cmd.kind !== "ping") {
      pushLog(`→ ${full.kind} ${full.selector ?? full.url ?? full.value ?? ""}`);
    }

    dc.send(JSON.stringify(full));
    return full.id;
  }, [pushLog]);

  // -------------------------------------------------------------------------
  // Realtime: mudanças no status da sessão
  // -------------------------------------------------------------------------
  useEffect(() => {
    const ch = supabase
      .channel(`super:session:${session.id}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE", schema: "public",
          table: "remote_support_sessions",
          filter: `id=eq.${session.id}`,
        },
        p => setStatus((p.new as SupportSession).status),
      )
      .subscribe();

    return () => { supabase.removeChannel(ch); };
  }, [session.id]);

  // -------------------------------------------------------------------------
  // WebRTC — estabelece peer quando sessão fica ativa
  // -------------------------------------------------------------------------
  useEffect(() => {
    if (status !== "active" || peerRef.current) return;

    setStage("subscribed");

    let cancelled = false;

    (async () => {
      try {
        const peer = await createOperatorPeer(
          session.id,
          // onStream
          (stream) => {
            if (videoRef.current) {
              videoRef.current.srcObject = stream;
              videoRef.current.play().catch(() => { /* autoplay policy — ok */ });
            }
            setHasStream(true);
            pushLog("📺 Vídeo recebido");
          },
          // onDataChannelOpen
          (dc) => {
            dcRef.current = dc;
            pushLog("🟢 Canal de comandos aberto");
            // Aplica qualidade inicial após 500ms (dá tempo do consultor processar)
            setTimeout(() => sendCmd({ kind: "qualityChange", value: quality }), 500);
          },
          // onDataMessage — recebe resultados e viewportInfo
          (msg) => {
            try {
              const parsed = JSON.parse(msg) as {
                id: string;
                kind?: string;
                ok?: boolean;
                error?: string;
                data?: unknown;
                viewport?: RequesterViewport;
              };

              // viewportInfo: enviado pelo consultor assim que o DataChannel abre.
              // Formato: { id: "viewport-info", kind: "viewportInfo", viewport: {...} }
              if (parsed.kind === "viewportInfo" && parsed.viewport) {
                setRequesterVp(parsed.viewport);
                pushLog(`📐 Viewport: ${parsed.viewport.innerWidth}×${parsed.viewport.innerHeight} @${parsed.viewport.dpr}x (${parsed.viewport.displaySurface ?? "?"})`);
                return;
              }

              // Resultado de comando normal
              const r = parsed as CommandResult;
              pendingRef.current.get(r.id)?.(r);
              pendingRef.current.delete(r.id);

              if (r.error === "paused_by_user") {
                setPaused(true);
              } else if (r.ok) {
                setPaused(false);
              }

              if (r.error && r.error !== "paused_by_user") {
                pushLog(`❌ ${r.id.slice(0, 6)}: ${r.error}`, false);
              }
            } catch { /* msg malformada — ignora */ }
          },
          // onStage
          (s, info) => {
            if (!cancelled) {
              setStage(s);
              pushLog(`📡 ${s}${info ? ` (${info})` : ""}`);
            }
          },
        );

        if (!cancelled) {
          peerRef.current = peer;
        } else {
          peer.close();
        }
      } catch (e) {
        if (!cancelled) {
          toast.error(e instanceof Error ? e.message : "Falha ao conectar via WebRTC");
          setStage("failed");
        }
      }
    })();

    return () => {
      cancelled = true;
      peerRef.current?.close();
      peerRef.current = null;
      dcRef.current = null;
      setHasStream(false);
      setStage("idle");
      setRequesterVp(null);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, session.id]);

  // -------------------------------------------------------------------------
  // RTT via ping a cada 2s
  // -------------------------------------------------------------------------
  useEffect(() => {
    if (!hasStream) return;

    const tick = () => {
      const dc = dcRef.current;
      if (!dc || dc.readyState !== "open") return;
      const id   = crypto.randomUUID();
      const sent = performance.now();
      pendingRef.current.set(id, () => setRtt(Math.round(performance.now() - sent)));
      dc.send(JSON.stringify({ id, kind: "ping" }));
      setTimeout(() => pendingRef.current.delete(id), 5_000);
    };

    tick();
    const t = setInterval(tick, 2_000);
    return () => clearInterval(t);
  }, [hasStream]);

  // -------------------------------------------------------------------------
  // FPS via getStats a cada 2s
  // -------------------------------------------------------------------------
  useEffect(() => {
    if (!hasStream) return;
    const t = setInterval(async () => {
      const pc = peerRef.current?.pc;
      if (!pc) return;
      const f = await getInboundVideoFps(pc);
      if (f !== null) setFps(Math.round(f));
    }, 2_000);
    return () => clearInterval(t);
  }, [hasStream]);

  // -------------------------------------------------------------------------
  // Fullscreen API
  // -------------------------------------------------------------------------
  const toggleFullscreen = useCallback(async () => {
    const el = containerRef.current;
    if (!el) return;
    if (!document.fullscreenElement) {
      try { await el.requestFullscreen(); } catch (e) {
        toast.error(e instanceof Error ? e.message : "Erro ao entrar em tela cheia");
      }
    } else {
      try { await document.exitFullscreen(); } catch { /* ignora */ }
    }
  }, []);

  useEffect(() => {
    const onFs = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", onFs);
    return () => document.removeEventListener("fullscreenchange", onFs);
  }, []);

  // -------------------------------------------------------------------------
  // Atalhos de teclado do operador
  // -------------------------------------------------------------------------
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!e.ctrlKey || !e.shiftKey) return;
      const k = e.key.toLowerCase();
      if      (k === "c") { e.preventDefault(); setControlEnabled(v => !v); }
      else if (k === "f") { e.preventDefault(); void toggleFullscreen(); }
      else if (k === "s") { e.preventDefault(); takeScreenshot(); }
      else if (k === "e") { e.preventDefault(); setConfirmEnd(true); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [toggleFullscreen]);

  // -------------------------------------------------------------------------
  // Screenshot
  // -------------------------------------------------------------------------
  const takeScreenshot = useCallback(() => {
    const v = videoRef.current;
    if (!v || !v.videoWidth) { toast.error("Sem vídeo para capturar"); return; }

    const canvas = document.createElement("canvas");
    canvas.width  = v.videoWidth;
    canvas.height = v.videoHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(v, 0, 0);

    canvas.toBlob(blob => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const a   = document.createElement("a");
      a.href     = url;
      a.download = `suporte-${consultantName}-${new Date().toISOString().replace(/[:.]/g, "-")}.png`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success("Screenshot salva");
    }, "image/png");
  }, [consultantName]);

  const copySessionCode = useCallback(() => {
    navigator.clipboard.writeText(session.id)
      .then(() => toast.success("ID da sessão copiado"))
      .catch(() => toast.error("Erro ao copiar"));
  }, [session.id]);

  // -------------------------------------------------------------------------
  // Qualidade
  // -------------------------------------------------------------------------
  const changeQuality = useCallback((q: QualityLevel) => {
    setQuality(q);
    sendCmd({ kind: "qualityChange", value: q });
    pushLog(`⚙️ qualidade: ${q}`);
  }, [sendCmd, pushLog]);

  // -------------------------------------------------------------------------
  // Verificar código
  // -------------------------------------------------------------------------
  const handleVerifyCode = async () => {
    setVerifying(true);
    try {
      await verifyCode(session.id, codeInput.trim());
      toast.success("Sessão ativada");
      setCodeInput("");
    } catch (e) {
      const err = e as Error & { attempts_left?: number };
      const left = err.attempts_left;
      toast.error(`${err.message}${typeof left === "number" ? ` (${left} tentativas restantes)` : ""}`);
    } finally {
      setVerifying(false);
    }
  };

  const handleEnd = async () => {
    await endSession(session.id, "operator_ended");
    onClose();
  };

  // -------------------------------------------------------------------------
  // Cores de latência
  // -------------------------------------------------------------------------
  const rttColor =
    rtt === null   ? "bg-zinc-600"   :
    rtt < 100      ? "bg-green-600"  :
    rtt < 300      ? "bg-yellow-500" :
                     "bg-red-600";

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------
  return (
    <Dialog open onOpenChange={open => { if (!open) onClose(); }}>
      <DialogContent
        className={
          isFullscreen
            ? "max-w-none w-screen h-screen p-0 border-0 rounded-none"
            : "max-w-7xl h-[92vh] flex flex-col"
        }
      >
        {!isFullscreen && (
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              Suporte: {consultantName}
              <Badge variant={status === "active" ? "default" : "secondary"}>{status}</Badge>
            </DialogTitle>
          </DialogHeader>
        )}

        {/* Entrada de código */}
        {status === "pending_code" && (
          <div className="flex items-center gap-2 p-3 rounded-md bg-muted">
            <Input
              placeholder="Código de 6 dígitos"
              value={codeInput}
              onChange={e => setCodeInput(e.target.value.replace(/\D/g, "").slice(0, 6))}
              onKeyDown={e => e.key === "Enter" && codeInput.length === 6 && handleVerifyCode()}
              maxLength={6}
              className="font-mono text-lg tracking-[0.3em] max-w-[220px]"
              autoFocus
            />
            <Button
              disabled={codeInput.length !== 6 || verifying}
              onClick={handleVerifyCode}
            >
              {verifying ? <Loader2 className="animate-spin size-4" /> : "Validar"}
            </Button>
          </div>
        )}

        {status === "requested" && (
          <div className="p-4 rounded-md bg-muted text-sm text-muted-foreground">
            Aguardando o consultor autorizar o acesso…
          </div>
        )}

        {/* Área principal — vídeo + painel lateral */}
        {status === "active" && (
          <div
            className={`flex-1 grid gap-3 overflow-hidden ${
              sidePanel && !isFullscreen ? "grid-cols-1 md:grid-cols-3" : "grid-cols-1"
            }`}
          >
            {/* Player */}
            <div
              ref={containerRef}
              className={`${sidePanel && !isFullscreen ? "md:col-span-2" : ""} bg-black rounded-md overflow-hidden relative`}
            >
              <video
                ref={videoRef}
                onLoadedMetadata={() => {
                  setVideoReady(true);
                  toast.success("Controle ativo", { duration: 2_500 });
                }}
                onEmptied={() => setVideoReady(false)}
                className="w-full h-full object-contain pointer-events-none select-none"
                autoPlay playsInline muted
              />

              {/* Toolbar flutuante */}
              {hasStream && (
                <PlayerToolbar
                  isFullscreen={isFullscreen}
                  controlEnabled={controlEnabled}
                  onToggleControl={() => setControlEnabled(v => !v)}
                  quality={quality}
                  onChangeQuality={changeQuality}
                  onScreenshot={takeScreenshot}
                  onFullscreen={toggleFullscreen}
                  onCopyCode={copySessionCode}
                  onEnd={() => setConfirmEnd(true)}
                  rtt={rtt} rttColor={rttColor} fps={fps}
                  paused={paused}
                  sidePanel={sidePanel}
                  onToggleSidePanel={() => setSidePanel(v => !v)}
                />
              )}

              {/* Overlay de controle remoto */}
              {hasStream && controlEnabled && videoReady && (
                <RemoteControlOverlay
                  videoRef={videoRef}
                  requesterVp={requesterVp}
                  sendCmd={sendCmd}
                />
              )}

              {hasStream && controlEnabled && !videoReady && (
                <div className="absolute inset-0 flex items-center justify-center bg-black/50 text-white text-xs pointer-events-none">
                  <Loader2 className="size-4 animate-spin mr-2" />
                  Aguardando metadados do vídeo…
                </div>
              )}

              {/* Pausa */}
              {paused && hasStream && (
                <div className="absolute inset-0 flex items-center justify-center bg-black/70 text-white text-center p-4 pointer-events-none">
                  <div>
                    <div className="text-2xl font-bold mb-1">Controle pausado</div>
                    <div className="text-sm opacity-80">
                      O consultor pausou o controle. Você ainda vê a tela.
                    </div>
                  </div>
                </div>
              )}

              {/* Sem vídeo */}
              {!hasStream && (
                <div className="absolute inset-0 flex flex-col items-center justify-center text-white text-sm text-center p-4 gap-2">
                  {(["offer-received", "answer-sent", "ice-checking", "connected"] as RtcStage[]).includes(stage) ? (
                    <><Loader2 className="animate-spin size-5" /> Conectando… ({stage})</>
                  ) : stage === "failed" ? (
                    <span className="text-red-400">
                      Falha na conexão. Peça ao consultor para clicar em "Compartilhar tela" novamente.
                    </span>
                  ) : (
                    <>Aguardando o consultor clicar em <b>"Compartilhar tela"</b> no banner vermelho.</>
                  )}
                </div>
              )}
            </div>

            {/* Painel lateral */}
            {sidePanel && !isFullscreen && (
              <SidePanel
                stage={stage}
                rtt={rtt} rttColor={rttColor} fps={fps}
                quality={quality}
                controlEnabled={controlEnabled}
                navUrl={navUrl}
                onNavUrlChange={setNavUrl}
                onSendCmd={sendCmd}
                logs={logs}
                requesterVp={requesterVp}
              />
            )}
          </div>
        )}

        {!isFullscreen && (
          <DialogFooter>
            <Button variant="outline" onClick={onClose}>Fechar painel</Button>
            <Button variant="destructive" onClick={() => setConfirmEnd(true)}>
              Encerrar sessão
            </Button>
          </DialogFooter>
        )}

        {/* Confirmação de encerramento */}
        <Dialog open={confirmEnd} onOpenChange={setConfirmEnd}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>Encerrar sessão de suporte?</DialogTitle>
            </DialogHeader>
            <p className="text-sm text-muted-foreground">
              O consultor perderá o controle remoto imediatamente.
            </p>
            <DialogFooter>
              <Button variant="outline" onClick={() => setConfirmEnd(false)}>Cancelar</Button>
              <Button variant="destructive" onClick={handleEnd}>Encerrar agora</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </DialogContent>
    </Dialog>
  );
}

// =============================================================================
// SidePanel — status, navegação, atalhos e log
// =============================================================================

function SidePanel({
  stage, rtt, rttColor, fps, quality, controlEnabled,
  navUrl, onNavUrlChange, onSendCmd, logs, requesterVp,
}: {
  stage: RtcStage;
  rtt: number | null; rttColor: string; fps: number | null;
  quality: QualityLevel; controlEnabled: boolean;
  navUrl: string; onNavUrlChange: (v: string) => void;
  onSendCmd: (cmd: Omit<RemoteCommand, "id">) => void;
  logs: { id: string; text: string; ok?: boolean }[];
  requesterVp: RequesterViewport | null;
}) {
  return (
    <div className="space-y-3 overflow-auto pr-1">

      {/* Status */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <Activity className="size-4" /> Status da conexão
          </CardTitle>
        </CardHeader>
        <CardContent className="text-xs space-y-1.5">
          <div>Estágio: <Badge variant="outline">{stage}</Badge></div>
          <div>
            Latência:{" "}
            <Badge className={`${rttColor} text-white`}>{rtt ?? "—"} ms</Badge>
          </div>
          <div>FPS: <Badge variant="outline">{fps ?? "—"}</Badge></div>
          <div>Qualidade: <Badge variant="outline">{quality}</Badge></div>
          <div>
            Controle:{" "}
            <Badge className={controlEnabled ? "bg-green-600 text-white" : "bg-zinc-600 text-white"}>
              {controlEnabled ? "ATIVO" : "Desativado"}
            </Badge>
          </div>
          {requesterVp && (
            <>
              <div>
                Viewport consultor:{" "}
                <span className="font-mono">{requesterVp.innerWidth}×{requesterVp.innerHeight}</span>
              </div>
              <div>
                DPR consultor:{" "}
                <span className="font-mono">{requesterVp.dpr}x</span>
              </div>
              <div>
                Superfície:{" "}
                <Badge
                  variant="outline"
                  className={requesterVp.displaySurface !== "browser" ? "border-yellow-500 text-yellow-600" : ""}
                >
                  {requesterVp.displaySurface ?? "desconhecida"}
                </Badge>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* Aviso de superfície não-aba */}
      {requesterVp && requesterVp.displaySurface && requesterVp.displaySurface !== "browser" && (
        <div className="flex items-start gap-2 text-[11px] text-yellow-700 bg-yellow-50 border border-yellow-200 rounded p-2">
          <AlertTriangle className="size-4 shrink-0 mt-0.5 text-yellow-500" />
          <span>
            O consultor está compartilhando uma <b>{requesterVp.displaySurface === "monitor" ? "tela inteira" : "janela"}</b>{" "}
            em vez da aba do navegador. Os cliques podem não ser precisos.
            Peça para ele recompartilhar e selecionar a <b>aba</b>.
          </span>
        </div>
      )}

      {/* Aviso sem viewportInfo */}
      {!requesterVp && (
        <div className="text-[11px] text-muted-foreground border border-dashed rounded p-2">
          ℹ️ O controle remoto funciona apenas dentro do painel iGreen (mesma aba compartilhada).
        </div>
      )}

      {/* Navegação */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Navegação</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <Input
            placeholder="https://…"
            value={navUrl}
            onChange={e => onNavUrlChange(e.target.value)}
            onKeyDown={e => e.key === "Enter" && navUrl && onSendCmd({ kind: "navigate", url: navUrl })}
          />
          <Button
            size="sm" className="w-full"
            disabled={!navUrl}
            onClick={() => onSendCmd({ kind: "navigate", url: navUrl })}
          >
            Ir
          </Button>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" className="flex-1"
              onClick={() => onSendCmd({ kind: "back" })}>Voltar</Button>
            <Button size="sm" variant="outline" className="flex-1"
              onClick={() => onSendCmd({ kind: "forward" })}>Avançar</Button>
            <Button size="sm" variant="outline" className="flex-1"
              onClick={() => onSendCmd({ kind: "reload" })}>Recarregar</Button>
          </div>
        </CardContent>
      </Card>

      {/* Atalhos */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <KeyboardIcon className="size-4" /> Atalhos
          </CardTitle>
        </CardHeader>
        <CardContent className="text-xs font-mono space-y-1 text-muted-foreground">
          <div><b>Ctrl+Shift+C</b> — controle on/off</div>
          <div><b>Ctrl+Shift+F</b> — tela cheia</div>
          <div><b>Ctrl+Shift+S</b> — screenshot</div>
          <div><b>Ctrl+Shift+E</b> — encerrar sessão</div>
        </CardContent>
      </Card>

      {/* Log */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Log de ações</CardTitle>
        </CardHeader>
        <CardContent>
          <ScrollArea className="h-44">
            <div className="space-y-1 text-[11px] font-mono">
              {logs.length === 0 && (
                <span className="text-muted-foreground">Nenhuma ação ainda.</span>
              )}
              {logs.map(l => (
                <div
                  key={l.id}
                  className={l.ok === false ? "text-destructive" : "text-muted-foreground"}
                >
                  {l.text}
                </div>
              ))}
            </div>
          </ScrollArea>
        </CardContent>
      </Card>
    </div>
  );
}

// =============================================================================
// PlayerToolbar — barra flutuante sobre o vídeo
// =============================================================================

interface PlayerToolbarProps {
  isFullscreen: boolean;
  controlEnabled: boolean; onToggleControl: () => void;
  quality: QualityLevel; onChangeQuality: (q: QualityLevel) => void;
  onScreenshot: () => void; onFullscreen: () => void;
  onCopyCode: () => void; onEnd: () => void;
  rtt: number | null; rttColor: string; fps: number | null;
  paused: boolean;
  sidePanel: boolean; onToggleSidePanel: () => void;
}

function PlayerToolbar({
  isFullscreen, controlEnabled, onToggleControl,
  quality, onChangeQuality, onScreenshot, onFullscreen,
  onCopyCode, onEnd, rtt, rttColor, fps, paused,
  sidePanel, onToggleSidePanel,
}: PlayerToolbarProps) {
  const [visible,   setVisible]   = useState(true);
  const hideTimer   = useRef<number | null>(null);

  // Auto-hide apenas em fullscreen
  useEffect(() => {
    if (!isFullscreen) { setVisible(true); return; }

    const show = () => {
      setVisible(true);
      if (hideTimer.current !== null) window.clearTimeout(hideTimer.current);
      hideTimer.current = window.setTimeout(() => setVisible(false), 3_000);
    };

    show();
    window.addEventListener("mousemove", show);
    return () => {
      window.removeEventListener("mousemove", show);
      if (hideTimer.current !== null) window.clearTimeout(hideTimer.current);
    };
  }, [isFullscreen]);

  return (
    <div
      className={`
        absolute top-2 left-1/2 -translate-x-1/2 z-30
        flex items-center gap-1.5
        bg-black/75 backdrop-blur text-white text-xs
        px-2 py-1.5 rounded-lg shadow-lg
        transition-opacity duration-300
        ${visible ? "opacity-100" : "opacity-0 pointer-events-none"}
      `}
    >
      {/* Controle on/off */}
      <button
        onClick={onToggleControl}
        title="Ctrl+Shift+C — ativar/desativar controle"
        className={`px-2 py-1 rounded flex items-center gap-1 transition-colors ${
          controlEnabled
            ? "bg-green-600 hover:bg-green-500"
            : "bg-zinc-700 hover:bg-zinc-600"
        }`}
      >
        <MousePointer2 className="size-3.5" />
        {controlEnabled ? "Controle" : "Somente ver"}
      </button>

      {/* Qualidade */}
      <select
        value={quality}
        onChange={e => onChangeQuality(e.target.value as QualityLevel)}
        className="bg-zinc-800 hover:bg-zinc-700 rounded px-1.5 py-1 text-xs"
        title="Qualidade do vídeo"
      >
        <option value="auto">Auto</option>
        <option value="high">Alta</option>
        <option value="medium">Média</option>
        <option value="low">Baixa</option>
      </select>

      {/* RTT */}
      <span className={`px-1.5 py-0.5 rounded ${rttColor} text-white`} title="Latência (ping)">
        {rtt ?? "—"}ms
      </span>

      {/* FPS */}
      <span className="px-1.5 py-0.5 rounded bg-zinc-700" title="FPS recebido">
        {fps ?? "—"}fps
      </span>

      {paused && (
        <span className="px-1.5 py-0.5 rounded bg-yellow-500 text-black font-semibold">
          PAUSADO
        </span>
      )}

      <div className="w-px h-5 bg-white/20 mx-0.5" />

      <button onClick={onScreenshot} title="Ctrl+Shift+S — screenshot"
        className="p-1.5 rounded hover:bg-white/10">
        <Camera className="size-3.5" />
      </button>
      <button onClick={onCopyCode} title="Copiar ID da sessão"
        className="p-1.5 rounded hover:bg-white/10">
        <Copy className="size-3.5" />
      </button>
      <button onClick={onToggleSidePanel} title="Painel lateral"
        className="p-1.5 rounded hover:bg-white/10 hidden md:block">
        {sidePanel ? "‹" : "›"}
      </button>
      <button onClick={onFullscreen} title="Ctrl+Shift+F — tela cheia"
        className="p-1.5 rounded hover:bg-white/10">
        {isFullscreen ? <Minimize2 className="size-3.5" /> : <Maximize2 className="size-3.5" />}
      </button>
      <button onClick={onEnd} title="Ctrl+Shift+E — encerrar sessão"
        className="p-1.5 rounded bg-red-600 hover:bg-red-500">
        <X className="size-3.5" />
      </button>
    </div>
  );
}

// =============================================================================
// HistoryView — histórico de sessões
// =============================================================================

function HistoryView({ consultants }: { consultants: ConsultantRow[] }) {
  const [rows, setRows] = useState<SupportSession[]>([]);

  useEffect(() => {
    supabase
      .from("remote_support_sessions" as "remote_support_sessions")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(50)
      .then(({ data }) => setRows((data ?? []) as unknown as SupportSession[]));
  }, []);

  const name = (id: string | null) =>
    (id && consultants.find(c => c.id === id)?.name) ?? id?.slice(0, 8) ?? "—";

  return (
    <Card>
      <CardContent className="p-0">
        <ScrollArea className="h-[60vh]">
          <table className="w-full text-sm">
            <thead className="bg-muted sticky top-0">
              <tr>
                <th className="p-2 text-left font-medium">Quando</th>
                <th className="p-2 text-left font-medium">Consultor</th>
                <th className="p-2 text-left font-medium">Operador</th>
                <th className="p-2 text-left font-medium">Status</th>
                <th className="p-2 text-left font-medium">Motivo</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr>
                  <td colSpan={5} className="p-4 text-center text-muted-foreground">
                    Nenhum registro.
                  </td>
                </tr>
              )}
              {rows.map(r => (
                <tr key={r.id} className="border-t hover:bg-muted/40">
                  <td className="p-2 whitespace-nowrap">
                    {new Date(r.created_at).toLocaleString()}
                  </td>
                  <td className="p-2">{name(r.requester_id)}</td>
                  <td className="p-2">{name(r.operator_id)}</td>
                  <td className="p-2">
                    <Badge variant="outline">{r.status}</Badge>
                  </td>
                  <td className="p-2 text-muted-foreground">{r.end_reason ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </ScrollArea>
      </CardContent>
    </Card>
  );
}

// =============================================================================
// RemoteControlOverlay — captura mouse/teclado do operador e envia ao consultor
// =============================================================================
//
// Correções v3:
//   - toNorm usa requesterVp (DPR + innerWidth/Height do consultor) para
//     mapear coordenadas com precisão em telas Retina e janelas de tamanho
//     diferente entre operador e consultor.
//   - Foco automático ao montar (autoFocus via useEffect).
//   - Cursor visível desde o início (opacity: 1, não precisa de move).
//   - Wheel envia deltaMode para normalização no actionHandler.
//   - DRAG_THRESHOLD preservado.
//
// Como funciona o mapeamento de coordenadas:
//   O vídeo exibido no operador tem resolução = viewport CSS do consultor × DPR.
//   O <video> usa object-contain dentro de um container de tamanho variável.
//   toNorm() compensa o letterbox e retorna coordenadas 0..1 relativas ao
//   viewport CSS do consultor, que é exatamente o que window.innerWidth/Height
//   representa no actionHandler do consultor.

function RemoteControlOverlay({
  videoRef,
  requesterVp,
  sendCmd,
}: {
  videoRef: React.RefObject<HTMLVideoElement>;
  requesterVp: RequesterViewport | null;
  sendCmd: (cmd: Omit<RemoteCommand, "id">) => void;
}) {
  const overlayRef = useRef<HTMLDivElement>(null);
  const cursorRef  = useRef<HTMLDivElement>(null);
  const flashRef   = useRef<HTMLDivElement>(null);

  // Coalescing de mouse move e wheel — um envio por frame de animação
  const pendingMove  = useRef<{ x: number; y: number } | null>(null);
  const pendingWheel = useRef<{ x: number; y: number; dx: number; dy: number; deltaMode: number } | null>(null);
  const rafId        = useRef<number | null>(null);

  // Foca o overlay ao montar para o teclado funcionar imediatamente
  useEffect(() => {
    const el = overlayRef.current;
    if (el) {
      el.focus({ preventScroll: true });
    }
  }, []);

  // Cancela RAF pendente ao desmontar
  useEffect(() => {
    return () => {
      if (rafId.current !== null) cancelAnimationFrame(rafId.current);
    };
  }, []);

  const schedule = useCallback(() => {
    if (rafId.current !== null) return;
    rafId.current = requestAnimationFrame(() => {
      rafId.current = null;

      if (pendingMove.current) {
        sendCmd({ kind: "mouseMove", x: pendingMove.current.x, y: pendingMove.current.y });
        pendingMove.current = null;
      }

      if (pendingWheel.current) {
        const w = pendingWheel.current;
        sendCmd({
          kind: "wheel",
          x: w.x, y: w.y,
          dx: w.dx, dy: w.dy,
          // Envia deltaMode para o consultor normalizar corretamente
          ...(w.deltaMode !== WheelEvent.DOM_DELTA_PIXEL ? { deltaMode: w.deltaMode } : {}),
        } as Omit<RemoteCommand, "id">);
        pendingWheel.current = null;
      }
    });
  }, [sendCmd]);

  // -------------------------------------------------------------------------
  // Mapeamento de coordenadas
  //
  // Precisamos mapear a posição do mouse no <video> (que usa object-contain)
  // para coordenadas normalizadas 0..1 do viewport CSS do consultor.
  //
  // Se temos requesterVp com innerWidth/innerHeight, usamos essas dimensões
  // como referência de "conteúdo real". Caso contrário, usamos videoWidth/Height.
  //
  // O DPR do consultor afeta a resolução do vídeo recebido:
  //   videoWidth = innerWidth × DPR (aprox.)
  //
  // Para obter a coordenada CSS normalizada:
  //   norm_x = pixel_no_video / videoWidth = css_pixel / innerWidth
  // Portanto não precisamos dividir pelo DPR — dividir por videoWidth já nos
  // dá a fração correta em relação ao viewport CSS.
  // -------------------------------------------------------------------------
  const toNorm = useCallback((e: { clientX: number; clientY: number }) => {
    const video = videoRef.current;
    const host  = overlayRef.current;
    if (!video || !host) return null;

    const rect = host.getBoundingClientRect();

    // Dimensões do conteúdo do vídeo (resolução nativa capturada)
    const vw = video.videoWidth  || rect.width;
    const vh = video.videoHeight || rect.height;

    // Cálculo do letterbox (object-contain)
    const scale  = Math.min(rect.width / vw, rect.height / vh);
    const dispW  = vw * scale;
    const dispH  = vh * scale;
    const offsetX = (rect.width  - dispW) / 2;
    const offsetY = (rect.height - dispH) / 2;

    // Pixel dentro da área de exibição do vídeo
    const px = e.clientX - rect.left - offsetX;
    const py = e.clientY - rect.top  - offsetY;

    // Fora dos limites → nulo
    if (px < 0 || py < 0 || px > dispW || py > dispH) return null;

    // Coordenada normalizada 0..1 relativa ao viewport CSS do consultor.
    // Dividir por dispW/dispH equivale a dividir por vw/vh × scale,
    // o que nos dá a fração correta independente do DPR.
    const normX = px / dispW;
    const normY = py / dispH;

    // Posição local para cursor virtual (relativa ao container)
    const localX = px + offsetX;
    const localY = py + offsetY;

    return { x: normX, y: normY, localX, localY };
  }, [videoRef]);

  // -------------------------------------------------------------------------
  // Cursor virtual
  // -------------------------------------------------------------------------
  const moveCursor = useCallback((lx: number, ly: number) => {
    const el = cursorRef.current;
    if (el) el.style.transform = `translate(${lx}px, ${ly}px)`;
  }, []);

  const flash = useCallback((lx: number, ly: number) => {
    const el = flashRef.current;
    if (!el) return;
    el.style.transform  = `translate(${lx - 14}px, ${ly - 14}px)`;
    el.style.opacity    = "1";
    el.style.transition = "none";
    requestAnimationFrame(() => {
      el.style.transition = "opacity 400ms ease-out, transform 400ms ease-out";
      el.style.opacity    = "0";
      el.style.transform  = `translate(${lx - 22}px, ${ly - 22}px) scale(1.6)`;
    });
  }, []);

  // -------------------------------------------------------------------------
  // Drag detection
  // -------------------------------------------------------------------------
  const downInfo  = useRef<{ x: number; y: number; button: number; promoted: boolean } | null>(null);
  // ~4px em 1000px de largura
  const DRAG_THRESHOLD_SQ = 0.004 * 0.004;

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    const p = toNorm(e);
    if (!p) return;

    moveCursor(p.localX, p.localY);

    // Promove para drag se ultrapassou o threshold
    const d = downInfo.current;
    if (d && !d.promoted) {
      const dx = p.x - d.x;
      const dy = p.y - d.y;
      if (dx * dx + dy * dy > DRAG_THRESHOLD_SQ) {
        d.promoted = true;
        sendCmd({ kind: "mouseDown", x: d.x, y: d.y, button: d.button });
      }
    }

    pendingMove.current = { x: p.x, y: p.y };
    schedule();
  }, [toNorm, moveCursor, sendCmd, schedule]);

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    const p = toNorm(e);
    if (!p) return;
    downInfo.current = { x: p.x, y: p.y, button: e.button, promoted: false };
    overlayRef.current?.focus({ preventScroll: true });
  }, [toNorm]);

  const onPointerUp = useCallback((e: React.PointerEvent) => {
    const p = toNorm(e);
    if (!p) return;
    const d = downInfo.current;
    downInfo.current = null;
    if (d?.promoted) {
      // Era drag — fecha com mouseUp. O click nativo não será disparado.
      sendCmd({ kind: "mouseUp", x: p.x, y: p.y, button: e.button });
    }
    // Se não era drag, o evento onClick vai cuidar do mouseClick.
  }, [toNorm, sendCmd]);

  const onPointerLeave = useCallback(() => {
    // Envia mouseUp se havia drag em andamento
    const d = downInfo.current;
    if (d?.promoted) {
      sendCmd({ kind: "mouseUp", x: d.x, y: d.y, button: d.button });
    }
    downInfo.current = null;
    // Mantém o cursor visível — não esconde ao sair do vídeo
  }, [sendCmd]);

  const onClick = useCallback((e: React.MouseEvent) => {
    const p = toNorm(e);
    if (!p) return;
    flash(p.localX, p.localY);
    sendCmd({ kind: "mouseClick", x: p.x, y: p.y, button: e.button });
  }, [toNorm, flash, sendCmd]);

  const onDoubleClick = useCallback((e: React.MouseEvent) => {
    const p = toNorm(e);
    if (!p) return;
    sendCmd({ kind: "mouseDblClick", x: p.x, y: p.y });
  }, [toNorm, sendCmd]);

  const onContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const p = toNorm(e);
    if (!p) return;
    flash(p.localX, p.localY);
    sendCmd({ kind: "contextMenu", x: p.x, y: p.y });
  }, [toNorm, flash, sendCmd]);

  const onWheel = useCallback((e: React.WheelEvent) => {
    const p = toNorm(e);
    if (!p) return;
    const prev = pendingWheel.current;
    pendingWheel.current = {
      x:  p.x, y: p.y,
      dx: (prev?.dx ?? 0) + e.deltaX,
      dy: (prev?.dy ?? 0) + e.deltaY,
      // Preserva o modo do primeiro evento do frame
      deltaMode: prev?.deltaMode ?? e.deltaMode,
    };
    schedule();
  }, [toNorm, schedule]);

  const onKeyDown = useCallback((e: React.KeyboardEvent) => {
    // Atalhos globais do operador têm prioridade
    if (e.ctrlKey && e.shiftKey) return;
    if ((e.ctrlKey || e.metaKey) && ["t", "n", "w", "r", "l"].includes(e.key.toLowerCase())) return;

    e.preventDefault();
    sendCmd({
      kind:  "key",
      key:   e.key,
      code:  e.code,
      ctrl:  e.ctrlKey,
      shift: e.shiftKey,
      alt:   e.altKey,
      meta:  e.metaKey,
    });
  }, [sendCmd]);

  // Exibe informações do viewport do consultor no title do overlay (debugging)
  const overlayTitle = requesterVp
    ? `Viewport consultor: ${requesterVp.innerWidth}×${requesterVp.innerHeight} @${requesterVp.dpr}x — ${requesterVp.displaySurface ?? "?"}`
    : "Aguardando viewport do consultor…";

  return (
    <>
      {/* Área de captura de eventos */}
      <div
        ref={overlayRef}
        tabIndex={0}
        title={overlayTitle}
        aria-label="Área de controle remoto"
        className="absolute inset-0 z-10 cursor-crosshair outline-none touch-none"
        onPointerMove={onPointerMove}
        onPointerDown={onPointerDown}
        onPointerUp={onPointerUp}
        onPointerLeave={onPointerLeave}
        onClick={onClick}
        onDoubleClick={onDoubleClick}
        onContextMenu={onContextMenu}
        onWheel={onWheel}
        onKeyDown={onKeyDown}
      />

      {/* Cursor virtual — visível desde o início */}
      <div
        ref={cursorRef}
        aria-hidden="true"
        className="absolute top-0 left-0 pointer-events-none z-20"
        style={{ willChange: "transform" }}
      >
        <div className="w-3 h-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-primary ring-2 ring-white shadow-md" />
      </div>

      {/* Flash de clique */}
      <div
        ref={flashRef}
        aria-hidden="true"
        className="absolute top-0 left-0 pointer-events-none w-7 h-7 rounded-full bg-primary/40 ring-2 ring-primary z-20"
        style={{ opacity: 0, willChange: "transform, opacity" }}
      />
    </>
  );
}
