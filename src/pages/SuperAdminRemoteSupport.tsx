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
import { ArrowLeft, ShieldAlert, Check, X, Eye, Send, Play, Square, Loader2 } from "lucide-react";
import { toast } from "sonner";
import type { SupportSession, RemoteCommand, CommandResult } from "@/features/remote-support/types";
import { acceptSession, endSession, operatorRequest, verifyCode } from "@/features/remote-support/api";
import { createOperatorPeer } from "@/features/remote-support/screenShare";

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
      .from("remote_support_sessions")
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

function SessionWorkbench({ session, consultantName, onClose }: {
  session: SupportSession; consultantName: string; onClose: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [codeInput, setCodeInput] = useState("");
  const [verifying, setVerifying] = useState(false);
  const [status, setStatus] = useState(session.status);
  const peerRef = useRef<Awaited<ReturnType<typeof createOperatorPeer>> | null>(null);
  const dcRef = useRef<RTCDataChannel | null>(null);
  const pendingRef = useRef<Map<string, (r: CommandResult) => void>>(new Map());
  const [logs, setLogs] = useState<{ id: string; text: string; ok?: boolean }[]>([]);
  const [connecting, setConnecting] = useState(false);
  const [navUrl, setNavUrl] = useState("");
  const [clickSel, setClickSel] = useState("");
  const [fillSel, setFillSel] = useState("");
  const [fillVal, setFillVal] = useState("");

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
    setConnecting(true);
    (async () => {
      try {
        const peer = await createOperatorPeer(
          session.id,
          (stream) => { if (videoRef.current) { videoRef.current.srcObject = stream; videoRef.current.play().catch(() => {}); } },
          (dc) => { dcRef.current = dc; setConnecting(false); pushLog("🟢 Canal de comandos aberto"); },
          (msg) => {
            try {
              const r = JSON.parse(msg) as CommandResult;
              pendingRef.current.get(r.id)?.(r);
              pendingRef.current.delete(r.id);
              pushLog(`${r.ok ? "✅" : "❌"} resp ${r.id}${r.error ? `: ${r.error}` : ""}`, r.ok);
            } catch {}
          },
        );
        peerRef.current = peer;
      } catch (e: any) {
        toast.error(e.message || "Falha WebRTC");
        setConnecting(false);
      }
    })();
    return () => { peerRef.current?.close(); peerRef.current = null; dcRef.current = null; };
  }, [status, session.id]);

  const pushLog = (text: string, ok?: boolean) =>
    setLogs((l) => [{ id: crypto.randomUUID(), text, ok }, ...l].slice(0, 80));

  const sendCmd = useCallback((cmd: Omit<RemoteCommand, "id">) => {
    const dc = dcRef.current;
    if (!dc || dc.readyState !== "open") { toast.error("Canal não está aberto"); return; }
    const full: RemoteCommand = { ...cmd, id: crypto.randomUUID() };
    pushLog(`→ ${full.kind} ${full.selector || full.url || full.value || ""}`);
    dc.send(JSON.stringify(full));
  }, []);

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

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-6xl h-[90vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            Suporte: {consultantName}
            <Badge variant={status === "active" ? "default" : "secondary"}>{status}</Badge>
          </DialogTitle>
        </DialogHeader>

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
          <div className="flex-1 grid grid-cols-1 md:grid-cols-3 gap-3 overflow-hidden">
            <div className="md:col-span-2 bg-black rounded-md overflow-hidden relative">
              <video ref={videoRef} className="w-full h-full object-contain" autoPlay playsInline muted />
              {connecting && (
                <div className="absolute inset-0 flex items-center justify-center text-white">
                  <Loader2 className="animate-spin mr-2" /> Conectando…
                </div>
              )}
              {!connecting && !videoRef.current?.srcObject && (
                <div className="absolute inset-0 flex items-center justify-center text-white text-sm text-center p-4">
                  Aguardando o consultor clicar em "Compartilhar tela" no banner vermelho.
                </div>
              )}
            </div>

            <div className="space-y-3 overflow-auto">
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
                <CardHeader className="pb-2"><CardTitle className="text-sm">Clicar</CardTitle></CardHeader>
                <CardContent className="space-y-2">
                  <Input placeholder="seletor CSS (#botao)" value={clickSel} onChange={e => setClickSel(e.target.value)} />
                  <Button size="sm" className="w-full" disabled={!clickSel} onClick={() => sendCmd({ kind: "click", selector: clickSel })}>Clicar</Button>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-2"><CardTitle className="text-sm">Preencher</CardTitle></CardHeader>
                <CardContent className="space-y-2">
                  <Input placeholder="seletor CSS" value={fillSel} onChange={e => setFillSel(e.target.value)} />
                  <Input placeholder="valor" value={fillVal} onChange={e => setFillVal(e.target.value)} />
                  <Button size="sm" className="w-full" disabled={!fillSel} onClick={() => sendCmd({ kind: "fill", selector: fillSel, value: fillVal })}>Preencher</Button>
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
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Fechar painel</Button>
          <Button variant="destructive" onClick={async () => { await endSession(session.id, "operator_ended"); onClose(); }}>
            Encerrar sessão
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ============== History ============== */
function HistoryView({ consultants }: { consultants: ConsultantRow[] }) {
  const [rows, setRows] = useState<SupportSession[]>([]);
  useEffect(() => {
    supabase.from("remote_support_sessions").select("*")
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
