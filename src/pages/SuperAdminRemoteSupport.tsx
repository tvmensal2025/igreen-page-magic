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
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import {
  ArrowLeft, ShieldAlert, Check, X, Eye, Send, Play, Square, Loader2,
  Maximize2, Minimize2, Camera, Copy, Activity, MousePointer2, KeyboardIcon,
} from "lucide-react";
import { toast } from "sonner";
import type { SupportSession, RemoteCommand, CommandResult } from "@/features/remote-support/types";
import { acceptSession, endSession, operatorRequest, verifyCode } from "@/features/remote-support/api";
import { createOperatorPeer, getInboundVideoFps, type RtcStage, type QualityLevel } from "@/features/remote-support/screenShare";

interface ConsultantRow { id: string; name: string; license: string }

export default function SuperAdminRemoteSupport() {
  const navigate = useNavigate();
  const { userId, loading: authLoading } = useAdminAuth();
  const { isSuperAdmin, loading: roleLoading } = useUserRole(userId);

  const [pending, setPending] = useState<SupportSession[]>([]);
  const [active, setActive] = useState<SupportSession[]>([]);
  const [consultants, setConsultants] = useState<ConsultantRow[]>([]);
  const [pickConsultant, setPickConsultant] = useState("");
  const [selectedSession, setSelectedSession] = useState<SupportSession | null>(null);

  useEffect(() => {
    if (!isSuperAdmin) return;
    supabase.from("consultants").select("id, name, license").order("name")
      .then(({ data }) => setConsultants((data || []) as ConsultantRow[]));
    refresh();
    const ch = supabase
      .channel("super:support:sessions")
      .on("postgres_changes", { event: "*", schema: "public", table: "remote_support_sessions" }, refresh)
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [isSuperAdmin]);

  const refresh = async () => {
    const { data } = await supabase
      .from("remote_support_sessions" as any)
      .select("*")
      .in("status", ["requested", "pending_code", "active"])
      .order("created_at", { ascending: false });
    const all = (data || []) as unknown as SupportSession[];
    setPending(all.filter(s => ["requested", "pending_code"].includes(s.status)));
    setActive(all.filter(s => s.status === "active"));
  };

  const consultantName = (id: string | null) =>
    (id && consultants.find(c => c.id === id)?.name) || id?.slice(0, 8) || "—";

  if (authLoading || roleLoading) {
    return <div className="p-8 flex items-center gap-2"><Loader2 className="animate-spin" /> Verificando…</div>;
  }
  if (!isSuperAdmin) {
    return (
      <div className="p-8 text-center space-y-3">
        <ShieldAlert className="size-10 mx-auto text-destructive" />
        <h1 className="text-xl font-bold">Acesso restrito</h1>
        <p className="text-muted-foreground">Apenas o Super Admin pode acessar o Suporte Remoto.</p>
        <Button onClick={() => navigate("/admin")}>Voltar</Button>
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
            <TabsTrigger value="active">Sessões ativas ({active.length})</TabsTrigger>
            <TabsTrigger value="start">Iniciar sessão</TabsTrigger>
            <TabsTrigger value="history">Histórico</TabsTrigger>
          </TabsList>

          <TabsContent value="queue" className="space-y-2">
            {pending.length === 0 && (
              <Card><CardContent className="p-6 text-center text-muted-foreground">Nenhum pedido.</CardContent></Card>
            )}
            {pending.map(s => (
              <Card key={s.id}>
                <CardContent className="p-4 flex items-center gap-3">
                  <Badge variant={s.status === "pending_code" ? "default" : "secondary"}>
                    {s.status === "pending_code" ? "Aguardando código" : "Novo pedido"}
                  </Badge>
                  <div className="flex-1">
                    <div className="font-medium">{consultantName(s.requester_id)}</div>
                    <div className="text-xs text-muted-foreground">
                      {new Date(s.created_at).toLocaleString()} · iniciado por: {s.initiated_by}
                    </div>
                  </div>
                  {s.status === "requested" ? (
                    <Button size="sm" onClick={async () => {
                      try { await acceptSession(s.id); toast.success("Código enviado ao consultor"); }
                      catch (e: any) { toast.error(e.message); }
                    }}>
                      <Check className="size-4 mr-1" /> Aceitar
                    </Button>
                  ) : (
                    <Button size="sm" onClick={() => setSelectedSession(s)}>
                      <Send className="size-4 mr-1" /> Digitar código
                    </Button>
                  )}
                  <Button size="sm" variant="ghost" onClick={() => endSession(s.id, "operator_cancelled")}>
                    <X className="size-4" />
                  </Button>
                </CardContent>
              </Card>
            ))}
          </TabsContent>

          <TabsContent value="active" className="space-y-2">
            {active.length === 0 && (
              <Card><CardContent className="p-6 text-center text-muted-foreground">Nenhuma sessão ativa.</CardContent></Card>
            )}
            {active.map(s => (
              <Card key={s.id}>
                <CardContent className="p-4 flex items-center gap-3">
                  <Badge className="bg-green-600">ATIVA</Badge>
                  <div className="flex-1">
                    <div className="font-medium">{consultantName(s.requester_id)}</div>
                    <div className="text-xs text-muted-foreground">
                      desde {s.started_at ? new Date(s.started_at).toLocaleTimeString() : "—"}
                    </div>
                  </div>
                  <Button size="sm" onClick={() => setSelectedSession(s)}>
                    <Eye className="size-4 mr-1" /> Abrir
                  </Button>
                  <Button size="sm" variant="destructive" onClick={() => endSession(s.id, "operator_ended")}>
                    <Square className="size-4" />
                  </Button>
                </CardContent>
              </Card>
            ))}
          </TabsContent>

          <TabsContent value="start">
            <Card>
              <CardHeader><CardTitle>Solicitar acesso a um consultor</CardTitle></CardHeader>
              <CardContent className="space-y-3">
                <select
                  className="w-full border rounded-md p-2 bg-background"
                  value={pickConsultant}
                  onChange={(e) => setPickConsultant(e.target.value)}
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
                    } catch (e: any) { toast.error(e.message); }
                  }}
                >
                  <Play className="size-4 mr-1" /> Solicitar acesso
                </Button>
              </CardContent>
            </Card>
          </TabsContent>

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

/* ============== Session workbench (player + commands) ============== */

/* ============== Session workbench (player + commands) ============== */

const PREFS_KEY = "remote_support_prefs_v1";
type Prefs = { control: boolean; quality: QualityLevel; sidePanel: boolean };
function loadPrefs(): Prefs {
  try { return { control: true, quality: "auto", sidePanel: true, ...JSON.parse(localStorage.getItem(PREFS_KEY) || "{}") }; }
  catch { return { control: true, quality: "auto", sidePanel: true }; }
}
function savePrefs(p: Prefs) { try { localStorage.setItem(PREFS_KEY, JSON.stringify(p)); } catch {} }

function SessionWorkbench({ session, consultantName, onClose }: {
  session: SupportSession; consultantName: string; onClose: () => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [codeInput, setCodeInput] = useState("");
  const [verifying, setVerifying] = useState(false);
  const [status, setStatus] = useState(session.status);
  const peerRef = useRef<Awaited<ReturnType<typeof createOperatorPeer>> | null>(null);
  const dcRef = useRef<RTCDataChannel | null>(null);
  const pendingRef = useRef<Map<string, (r: CommandResult) => void>>(new Map());
  const [logs, setLogs] = useState<{ id: string; text: string; ok?: boolean }[]>([]);
  const [stage, setStage] = useState<RtcStage>("idle");
  const [hasStream, setHasStream] = useState(false);
  const [navUrl, setNavUrl] = useState("");
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [rtt, setRtt] = useState<number | null>(null);
  const [fps, setFps] = useState<number | null>(null);
  const [paused, setPaused] = useState(false);
  const [confirmEnd, setConfirmEnd] = useState(false);

  const initialPrefs = useRef(loadPrefs()).current;
  const [controlEnabled, setControlEnabled] = useState(initialPrefs.control);
  const [quality, setQuality] = useState<QualityLevel>(initialPrefs.quality);
  const [sidePanel, setSidePanel] = useState(initialPrefs.sidePanel);

  useEffect(() => { savePrefs({ control: controlEnabled, quality, sidePanel }); }, [controlEnabled, quality, sidePanel]);

  const pushLog = useCallback((text: string, ok?: boolean) =>
    setLogs((l) => [{ id: crypto.randomUUID(), text, ok }, ...l].slice(0, 80)), []);

  const sendCmd = useCallback((cmd: Omit<RemoteCommand, "id">) => {
    const dc = dcRef.current;
    if (!dc || dc.readyState !== "open") return;
    const full: RemoteCommand = { ...cmd, id: crypto.randomUUID() };
    if (cmd.kind !== "mouseMove" && cmd.kind !== "wheel" && cmd.kind !== "ping") {
      pushLog(`→ ${full.kind} ${full.selector || full.url || full.value || ""}`);
    }
    dc.send(JSON.stringify(full));
    return full.id;
  }, [pushLog]);

  // Watch session status
  useEffect(() => {
    const ch = supabase
      .channel(`super:session:${session.id}`)
      .on("postgres_changes", {
        event: "UPDATE", schema: "public", table: "remote_support_sessions",
        filter: `id=eq.${session.id}`,
      }, (p) => setStatus((p.new as SupportSession).status))
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [session.id]);

  // When active, establish WebRTC
  useEffect(() => {
    if (status !== "active" || peerRef.current) return;
    setStage("subscribed");
    (async () => {
      try {
        const peer = await createOperatorPeer(
          session.id,
          (stream) => {
            if (videoRef.current) { videoRef.current.srcObject = stream; videoRef.current.play().catch(() => {}); }
            setHasStream(true);
            pushLog("📺 Vídeo recebido");
          },
          (dc) => {
            dcRef.current = dc;
            pushLog("🟢 Canal de comandos aberto");
            // aplica qualidade inicial após conectar
            setTimeout(() => sendCmd({ kind: "qualityChange", value: quality }), 500);
          },
          (msg) => {
            try {
              const r = JSON.parse(msg) as CommandResult;
              pendingRef.current.get(r.id)?.(r);
              pendingRef.current.delete(r.id);
              if (r.error === "paused_by_user") setPaused(true);
              else if (r.ok) setPaused(false);
              if (r.error && r.error !== "paused_by_user") pushLog(`❌ ${r.id.slice(0, 6)}: ${r.error}`, false);
            } catch {}
          },
          (s, info) => { setStage(s); pushLog(`📡 ${s}${info ? ` (${info})` : ""}`); },
        );
        peerRef.current = peer;
      } catch (e: any) {
        toast.error(e.message || "Falha WebRTC");
        setStage("failed");
      }
    })();
    return () => {
      peerRef.current?.close(); peerRef.current = null; dcRef.current = null;
      setHasStream(false); setStage("idle");
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, session.id]);

  // RTT via ping a cada 2s
  useEffect(() => {
    if (!hasStream) return;
    const tick = () => {
      const dc = dcRef.current;
      if (!dc || dc.readyState !== "open") return;
      const id = crypto.randomUUID();
      const sent = performance.now();
      pendingRef.current.set(id, () => setRtt(Math.round(performance.now() - sent)));
      dc.send(JSON.stringify({ id, kind: "ping" }));
      setTimeout(() => pendingRef.current.delete(id), 5000);
    };
    tick();
    const t = setInterval(tick, 2000);
    return () => clearInterval(t);
  }, [hasStream]);

  // FPS via getStats a cada 2s
  useEffect(() => {
    if (!hasStream) return;
    const t = setInterval(async () => {
      const pc = peerRef.current?.pc;
      if (!pc) return;
      const f = await getInboundVideoFps(pc);
      if (f !== null) setFps(Math.round(f));
    }, 2000);
    return () => clearInterval(t);
  }, [hasStream]);

  // Fullscreen API
  const toggleFullscreen = useCallback(async () => {
    const el = containerRef.current;
    if (!el) return;
    if (!document.fullscreenElement) {
      try { await el.requestFullscreen(); } catch (e: any) { toast.error(e.message); }
    } else {
      try { await document.exitFullscreen(); } catch {}
    }
  }, []);
  useEffect(() => {
    const onFs = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", onFs);
    return () => document.removeEventListener("fullscreenchange", onFs);
  }, []);

  // Mudar qualidade
  const changeQuality = (q: QualityLevel) => {
    setQuality(q);
    sendCmd({ kind: "qualityChange", value: q });
    pushLog(`⚙️ qualidade: ${q}`);
  };

  // Screenshot
  const takeScreenshot = useCallback(() => {
    const v = videoRef.current;
    if (!v || !v.videoWidth) { toast.error("Sem vídeo para capturar"); return; }
    const canvas = document.createElement("canvas");
    canvas.width = v.videoWidth; canvas.height = v.videoHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(v, 0, 0);
    canvas.toBlob((blob) => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `suporte-${consultantName}-${new Date().toISOString().replace(/[:.]/g, "-")}.png`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success("Screenshot salva");
    }, "image/png");
  }, [consultantName]);

  // Copiar código da sessão
  const copySessionCode = useCallback(() => {
    navigator.clipboard.writeText(session.id).then(() => toast.success("ID da sessão copiado"));
  }, [session.id]);

  // Atalhos
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!e.ctrlKey || !e.shiftKey) return;
      const k = e.key.toLowerCase();
      if (k === "c") { e.preventDefault(); setControlEnabled(v => !v); }
      else if (k === "f") { e.preventDefault(); toggleFullscreen(); }
      else if (k === "s") { e.preventDefault(); takeScreenshot(); }
      else if (k === "e") { e.preventDefault(); setConfirmEnd(true); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toggleFullscreen, takeScreenshot]);

  const handleVerifyCode = async () => {
    setVerifying(true);
    try {
      await verifyCode(session.id, codeInput.trim());
      toast.success("Sessão ativada");
      setCodeInput("");
    } catch (e: any) {
      const left = (e as { attempts_left?: number }).attempts_left;
      toast.error(`${e.message}${typeof left === "number" ? ` (${left} tentativas restantes)` : ""}`);
    } finally { setVerifying(false); }
  };

  const handleEnd = async () => {
    await endSession(session.id, "operator_ended");
    onClose();
  };

  const rttColor = rtt === null ? "bg-zinc-600" : rtt < 100 ? "bg-green-600" : rtt < 300 ? "bg-yellow-500" : "bg-red-600";

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className={isFullscreen ? "max-w-none w-screen h-screen p-0 border-0 rounded-none" : "max-w-7xl h-[92vh] flex flex-col"}>
        {!isFullscreen && (
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              Suporte: {consultantName}
              <Badge variant={status === "active" ? "default" : "secondary"}>{status}</Badge>
            </DialogTitle>
          </DialogHeader>
        )}

        {status === "pending_code" && (
          <div className="flex items-center gap-2 p-3 rounded-md bg-muted">
            <Input
              placeholder="Código de 6 dígitos"
              value={codeInput}
              onChange={(e) => setCodeInput(e.target.value.replace(/\D/g, "").slice(0, 6))}
              maxLength={6}
              className="font-mono text-lg tracking-[0.3em] max-w-[220px]"
            />
            <Button disabled={codeInput.length !== 6 || verifying} onClick={handleVerifyCode}>
              {verifying ? <Loader2 className="animate-spin size-4" /> : "Validar"}
            </Button>
          </div>
        )}

        {status === "requested" && (
          <div className="p-4 rounded-md bg-muted text-sm">
            Aguardando o consultor autorizar…
          </div>
        )}

        {status === "active" && (
          <div className={`flex-1 grid gap-3 overflow-hidden ${sidePanel && !isFullscreen ? "grid-cols-1 md:grid-cols-3" : "grid-cols-1"}`}>
            <div
              ref={containerRef}
              className={`${sidePanel && !isFullscreen ? "md:col-span-2" : ""} bg-black rounded-md overflow-hidden relative group`}
            >
              <video
                ref={videoRef}
                className="w-full h-full object-contain pointer-events-none select-none"
                autoPlay playsInline muted
              />

              {/* Toolbar flutuante (auto-hide em fullscreen) */}
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

              {hasStream && controlEnabled && (
                <RemoteControlOverlay videoRef={videoRef} sendCmd={sendCmd} />
              )}

              {paused && hasStream && (
                <div className="absolute inset-0 flex items-center justify-center bg-black/60 text-white text-center p-4 pointer-events-none">
                  <div>
                    <div className="text-2xl font-bold mb-1">Consultor pausou o controle</div>
                    <div className="text-sm opacity-80">Você ainda vê a tela, mas não pode interagir.</div>
                  </div>
                </div>
              )}

              {!hasStream && (
                <div className="absolute inset-0 flex flex-col items-center justify-center text-white text-sm text-center p-4 gap-2">
                  {stage === "offer-received" || stage === "answer-sent" || stage === "ice-checking" || stage === "connected" ? (
                    <><Loader2 className="animate-spin" /> Conectando vídeo… ({stage})</>
                  ) : stage === "failed" ? (
                    <span className="text-destructive">Falha na conexão. Peça ao consultor para clicar novamente em "Compartilhar tela".</span>
                  ) : (
                    <>Aguardando o consultor clicar em <b>"Compartilhar tela"</b> no banner vermelho.</>
                  )}
                </div>
              )}
            </div>

            {sidePanel && !isFullscreen && (
              <div className="space-y-3 overflow-auto">
                <Card>
                  <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><Activity className="size-4" /> Status</CardTitle></CardHeader>
                  <CardContent className="text-xs space-y-1">
                    <div>Estágio: <Badge variant="outline">{stage}</Badge></div>
                    <div>Latência: <Badge className={rttColor + " text-white"}>{rtt ?? "—"} ms</Badge></div>
                    <div>FPS recebido: <Badge variant="outline">{fps ?? "—"}</Badge></div>
                    <div>Qualidade: <Badge variant="outline">{quality}</Badge></div>
                    <div>Controle: <Badge className={controlEnabled ? "bg-green-600" : "bg-zinc-600"}>{controlEnabled ? "ATIVO" : "Off"}</Badge></div>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="pb-2"><CardTitle className="text-sm">Navegar</CardTitle></CardHeader>
                  <CardContent className="space-y-2">
                    <Input placeholder="https://…" value={navUrl} onChange={e => setNavUrl(e.target.value)} />
                    <Button size="sm" className="w-full" disabled={!navUrl} onClick={() => sendCmd({ kind: "navigate", url: navUrl })}>Ir</Button>
                    <div className="flex gap-2">
                      <Button size="sm" variant="outline" className="flex-1" onClick={() => sendCmd({ kind: "back" })}>Voltar</Button>
                      <Button size="sm" variant="outline" className="flex-1" onClick={() => sendCmd({ kind: "forward" })}>Avançar</Button>
                      <Button size="sm" variant="outline" className="flex-1" onClick={() => sendCmd({ kind: "reload" })}>Recarregar</Button>
                    </div>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><KeyboardIcon className="size-4" /> Atalhos</CardTitle></CardHeader>
                  <CardContent className="text-xs font-mono space-y-1 text-muted-foreground">
                    <div><b>Ctrl+Shift+C</b> — controle on/off</div>
                    <div><b>Ctrl+Shift+F</b> — tela cheia</div>
                    <div><b>Ctrl+Shift+S</b> — screenshot</div>
                    <div><b>Ctrl+Shift+E</b> — encerrar</div>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="pb-2"><CardTitle className="text-sm">Log</CardTitle></CardHeader>
                  <CardContent>
                    <ScrollArea className="h-40">
                      <div className="space-y-1 text-xs font-mono">
                        {logs.map(l => (
                          <div key={l.id} className={l.ok === false ? "text-destructive" : ""}>{l.text}</div>
                        ))}
                      </div>
                    </ScrollArea>
                  </CardContent>
                </Card>
              </div>
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

        <Dialog open={confirmEnd} onOpenChange={setConfirmEnd}>
          <DialogContent className="max-w-md">
            <DialogHeader><DialogTitle>Encerrar sessão de suporte?</DialogTitle></DialogHeader>
            <p className="text-sm text-muted-foreground">O consultor perderá o controle e o vídeo será encerrado imediatamente.</p>
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

/* ============== Player toolbar ============== */
function PlayerToolbar(props: {
  isFullscreen: boolean;
  controlEnabled: boolean; onToggleControl: () => void;
  quality: QualityLevel; onChangeQuality: (q: QualityLevel) => void;
  onScreenshot: () => void; onFullscreen: () => void; onCopyCode: () => void; onEnd: () => void;
  rtt: number | null; rttColor: string; fps: number | null;
  paused: boolean;
  sidePanel: boolean; onToggleSidePanel: () => void;
}) {
  const {
    isFullscreen, controlEnabled, onToggleControl, quality, onChangeQuality,
    onScreenshot, onFullscreen, onCopyCode, onEnd, rtt, rttColor, fps, paused,
    sidePanel, onToggleSidePanel,
  } = props;

  // Auto-hide em fullscreen
  const [visible, setVisible] = useState(true);
  const hideTimer = useRef<number | null>(null);
  useEffect(() => {
    if (!isFullscreen) { setVisible(true); return; }
    const show = () => {
      setVisible(true);
      if (hideTimer.current) window.clearTimeout(hideTimer.current);
      hideTimer.current = window.setTimeout(() => setVisible(false), 3000);
    };
    show();
    window.addEventListener("mousemove", show);
    return () => {
      window.removeEventListener("mousemove", show);
      if (hideTimer.current) window.clearTimeout(hideTimer.current);
    };
  }, [isFullscreen]);

  return (
    <div
      className={`absolute top-2 left-1/2 -translate-x-1/2 z-20 flex items-center gap-1.5 bg-black/75 backdrop-blur text-white text-xs px-2 py-1.5 rounded-lg shadow-lg transition-opacity ${visible ? "opacity-100" : "opacity-0 pointer-events-none"}`}
    >
      <button
        onClick={onToggleControl}
        className={`px-2 py-1 rounded flex items-center gap-1 ${controlEnabled ? "bg-green-600 hover:bg-green-500" : "bg-zinc-700 hover:bg-zinc-600"}`}
        title="Ctrl+Shift+C"
      >
        <MousePointer2 className="size-3.5" /> {controlEnabled ? "Controle" : "Ver"}
      </button>

      <select
        value={quality}
        onChange={(e) => onChangeQuality(e.target.value as QualityLevel)}
        className="bg-zinc-800 hover:bg-zinc-700 rounded px-1.5 py-1 text-xs"
        title="Qualidade do vídeo"
      >
        <option value="auto">Auto</option>
        <option value="high">Alta</option>
        <option value="medium">Média</option>
        <option value="low">Baixa</option>
      </select>

      <span className={`px-1.5 py-0.5 rounded ${rttColor} text-white`} title="Latência (ping)">
        {rtt ?? "—"}ms
      </span>
      <span className="px-1.5 py-0.5 rounded bg-zinc-700" title="FPS recebido">
        {fps ?? "—"}fps
      </span>

      {paused && (
        <span className="px-1.5 py-0.5 rounded bg-yellow-500 text-black font-semibold">PAUSADO</span>
      )}

      <div className="w-px h-5 bg-white/20 mx-1" />

      <button onClick={onScreenshot} title="Ctrl+Shift+S — screenshot" className="p-1.5 rounded hover:bg-white/10">
        <Camera className="size-3.5" />
      </button>
      <button onClick={onCopyCode} title="Copiar ID da sessão" className="p-1.5 rounded hover:bg-white/10">
        <Copy className="size-3.5" />
      </button>
      <button onClick={onToggleSidePanel} title="Mostrar/esconder painel" className="p-1.5 rounded hover:bg-white/10 hidden md:block">
        {sidePanel ? "‹" : "›"}
      </button>
      <button onClick={onFullscreen} title="Ctrl+Shift+F — tela cheia" className="p-1.5 rounded hover:bg-white/10">
        {isFullscreen ? <Minimize2 className="size-3.5" /> : <Maximize2 className="size-3.5" />}
      </button>
      <button onClick={onEnd} title="Ctrl+Shift+E — encerrar" className="p-1.5 rounded bg-red-600 hover:bg-red-500">
        <X className="size-3.5" />
      </button>
    </div>
  );
}


/* ============== History ============== */
function HistoryView({ consultants }: { consultants: ConsultantRow[] }) {
  const [rows, setRows] = useState<SupportSession[]>([]);
  useEffect(() => {
    supabase.from("remote_support_sessions" as any).select("*")
      .order("created_at", { ascending: false }).limit(50)
      .then(({ data }) => setRows((data || []) as unknown as SupportSession[]));
  }, []);
  const name = (id: string | null) => (id && consultants.find(c => c.id === id)?.name) || id?.slice(0, 8) || "—";
  return (
    <Card>
      <CardContent className="p-0">
        <ScrollArea className="h-[60vh]">
          <table className="w-full text-sm">
            <thead className="bg-muted sticky top-0">
              <tr><th className="p-2 text-left">Quando</th><th className="text-left">Consultor</th><th className="text-left">Operador</th><th className="text-left">Status</th><th className="text-left">Motivo</th></tr>
            </thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.id} className="border-t">
                  <td className="p-2">{new Date(r.created_at).toLocaleString()}</td>
                  <td>{name(r.requester_id)}</td>
                  <td>{name(r.operator_id)}</td>
                  <td><Badge variant="outline">{r.status}</Badge></td>
                  <td className="text-muted-foreground">{r.end_reason || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </ScrollArea>
      </CardContent>
    </Card>
  );
}

/* ============== Overlay de controle remoto (mouse + teclado) ============== */
function RemoteControlOverlay({
  videoRef, sendCmd,
}: {
  videoRef: React.RefObject<HTMLVideoElement>;
  sendCmd: (cmd: Omit<RemoteCommand, "id">) => void;
}) {
  const overlayRef = useRef<HTMLDivElement>(null);
  const lastMoveRef = useRef(0);
  const [enabled, setEnabled] = useState(true);

  const toNorm = (e: { clientX: number; clientY: number }) => {
    const video = videoRef.current;
    const host = overlayRef.current;
    if (!video || !host) return null;
    const rect = host.getBoundingClientRect();
    const vw = video.videoWidth || rect.width;
    const vh = video.videoHeight || rect.height;
    const scale = Math.min(rect.width / vw, rect.height / vh);
    const dispW = vw * scale;
    const dispH = vh * scale;
    const offsetX = (rect.width - dispW) / 2;
    const offsetY = (rect.height - dispH) / 2;
    const px = e.clientX - rect.left - offsetX;
    const py = e.clientY - rect.top - offsetY;
    if (px < 0 || py < 0 || px > dispW || py > dispH) return null;
    return { x: px / dispW, y: py / dispH };
  };

  const onMove = (e: React.PointerEvent) => {
    if (!enabled) return;
    const now = performance.now();
    if (now - lastMoveRef.current < 40) return;
    lastMoveRef.current = now;
    const p = toNorm(e); if (!p) return;
    sendCmd({ kind: "mouseMove", x: p.x, y: p.y });
  };

  const onClick = (e: React.MouseEvent) => {
    if (!enabled) return;
    const p = toNorm(e); if (!p) return;
    sendCmd({ kind: "mouseClick", x: p.x, y: p.y, button: e.button });
    overlayRef.current?.focus();
  };

  const onDblClick = (e: React.MouseEvent) => {
    if (!enabled) return;
    const p = toNorm(e); if (!p) return;
    sendCmd({ kind: "mouseDblClick", x: p.x, y: p.y });
  };

  const onContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    if (!enabled) return;
    const p = toNorm(e); if (!p) return;
    sendCmd({ kind: "contextMenu", x: p.x, y: p.y });
  };

  const onWheel = (e: React.WheelEvent) => {
    if (!enabled) return;
    const p = toNorm(e); if (!p) return;
    sendCmd({ kind: "wheel", x: p.x, y: p.y, dx: e.deltaX, dy: e.deltaY });
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (!enabled) return;
    if ((e.ctrlKey || e.metaKey) && ["t", "n", "w", "r", "l"].includes(e.key.toLowerCase())) return;
    e.preventDefault();
    sendCmd({
      kind: "key",
      key: e.key, code: e.code,
      ctrl: e.ctrlKey, shift: e.shiftKey, alt: e.altKey, meta: e.metaKey,
    });
  };

  return (
    <>
      <div
        ref={overlayRef}
        tabIndex={0}
        className="absolute inset-0 cursor-crosshair outline-none"
        onPointerMove={onMove}
        onClick={onClick}
        onDoubleClick={onDblClick}
        onContextMenu={onContextMenu}
        onWheel={onWheel}
        onKeyDown={onKeyDown}
      />
      <div className="absolute top-2 right-2 flex items-center gap-2 bg-black/60 text-white text-xs px-2 py-1 rounded-md">
        <button
          className={`px-2 py-0.5 rounded ${enabled ? "bg-green-600" : "bg-zinc-600"}`}
          onClick={() => setEnabled(v => !v)}
          title="Alternar controle remoto"
        >
          {enabled ? "Controle ATIVO" : "Apenas visualização"}
        </button>
        <span className="opacity-70 hidden md:inline">clique no vídeo p/ focar teclado</span>
      </div>
    </>
  );
}
