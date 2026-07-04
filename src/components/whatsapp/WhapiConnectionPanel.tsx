import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useWhapiHealth, type WhapiHealthStatus } from "@/hooks/useWhapiHealth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "sonner";
import { RefreshCcw, KeyRound, QrCode, LogOut, AlertTriangle, CheckCircle2, CreditCard, ExternalLink, History, Download } from "lucide-react";

interface Props {
  visible: boolean;
}

const statusMeta: Record<WhapiHealthStatus, { label: string; tone: "default" | "secondary" | "destructive" | "outline"; icon: React.ReactNode }> = {
  AUTH: { label: "Conectado", tone: "default", icon: <CheckCircle2 className="h-3.5 w-3.5" /> },
  QR: { label: "Aguardando QR", tone: "secondary", icon: <QrCode className="h-3.5 w-3.5" /> },
  INIT: { label: "Inicializando", tone: "secondary", icon: <RefreshCcw className="h-3.5 w-3.5 animate-spin" /> },
  OFFLINE: { label: "Offline", tone: "destructive", icon: <AlertTriangle className="h-3.5 w-3.5" /> },
  UNKNOWN: { label: "Desconhecido", tone: "outline", icon: <AlertTriangle className="h-3.5 w-3.5" /> },
};

export function WhapiConnectionPanel({ visible }: Props) {
  const health = useWhapiHealth(visible);
  const [tokenInput, setTokenInput] = useState("");
  const [busy, setBusy] = useState<null | "save" | "qr" | "logout" | "backfill" | "reauth" | "webhook">(null);
  const [qrImage, setQrImage] = useState<string | null>(null);
  const reauthPollRef = useRef<number | null>(null);
  const [backfillStatus, setBackfillStatus] = useState<any>(null);
  const pollRef = useRef<number | null>(null);

  const fetchBackfillStatus = async () => {
    try {
      const { data } = await supabase.functions.invoke("whapi-history-status", {
        method: "GET" as any,
      });
      if (data?.status) setBackfillStatus(data.status);
    } catch {/* silent */}
  };

  useEffect(() => {
    if (!visible) return;
    fetchBackfillStatus();
    pollRef.current = window.setInterval(() => {
      if (backfillStatus?.state === "running") fetchBackfillStatus();
    }, 5000);
    return () => {
      if (pollRef.current) window.clearInterval(pollRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, backfillStatus?.state]);

  const handleBackfill = async () => {
    if (!confirm(
      "Importar TODO o histórico do WhatsApp deste canal?\n\n" +
      "• Pode demorar de 30 a 90 minutos.\n" +
      "• Leads novos entram com o bot PAUSADO.\n" +
      "• Clientes já importados do iGreen são ignorados.\n" +
      "• Rodar 2× não duplica.\n\nContinuar?"
    )) return;
    setBusy("backfill");
    try {
      const { data, error } = await supabase.functions.invoke("whapi-history-backfill", {
        body: {},
      });
      if (error) throw new Error(error.message);
      if (data?.error === "backfill_already_running") {
        toast.info("Backfill já está rodando.");
      } else if (data?.error) {
        throw new Error(data.error);
      } else {
        toast.success("Importação iniciada em background.");
      }
      await fetchBackfillStatus();
    } catch (e: any) {
      toast.error(e?.message || "Erro ao iniciar importação");
    } finally {
      setBusy(null);
    }
  };

  if (!visible) return null;

  const meta = statusMeta[health.status] ?? statusMeta.UNKNOWN;

  const handleSaveToken = async () => {
    const t = tokenInput.trim();
    if (t.length < 16) {
      toast.error("Token Whapi inválido");
      return;
    }
    setBusy("save");
    try {
      const { data, error } = await supabase.functions.invoke("whapi-admin", {
        body: { action: "update_token", token: t },
      });
      if (error || data?.error) throw new Error(error?.message || data?.error || "Falha");
      toast.success("Token Whapi atualizado");
      setTokenInput("");
      await health.refresh();
    } catch (e: any) {
      toast.error(e?.message || "Erro ao salvar token");
    } finally {
      setBusy(null);
    }
  };

  const handleRequestQr = async () => {
    setBusy("qr");
    setQrImage(null);
    try {
      const { data, error } = await supabase.functions.invoke("whapi-proxy", {
        body: { action: "request_qr", payload: {} },
      });
      if (error || data?.error) throw new Error(error?.message || data?.error || "Falha");
      const qr: string | null = data?.qr || null;
      if (!qr) {
        toast.info("Canal não está em modo de pareamento. Faça logout primeiro.");
      } else {
        // Whapi pode devolver "data:image/..." ou só o base64
        setQrImage(qr.startsWith("data:") ? qr : `data:image/png;base64,${qr}`);
      }
      await health.refresh();
    } catch (e: any) {
      toast.error(e?.message || "Erro ao solicitar QR");
    } finally {
      setBusy(null);
    }
  };

  const handleLogout = async () => {
    if (!confirm("Desconectar canal Whapi? Você precisará escanear o QR de novo.")) return;
    setBusy("logout");
    try {
      const { data, error } = await supabase.functions.invoke("whapi-proxy", {
        body: { action: "logout", payload: {} },
      });
      if (error || data?.error) throw new Error(error?.message || data?.error || "Falha");
      toast.success("Canal Whapi desconectado");
      await health.refresh();
    } catch (e: any) {
      toast.error(e?.message || "Erro ao desconectar");
    } finally {
      setBusy(null);
    }
  };

  const stopReauthPoll = () => {
    if (reauthPollRef.current) {
      window.clearInterval(reauthPollRef.current);
      reauthPollRef.current = null;
    }
  };

  const handleReauth = async () => {
    setBusy("reauth");
    setQrImage(null);
    try {
      const { data, error } = await supabase.functions.invoke("whapi-proxy", {
        body: { action: "reauth", payload: {} },
      });
      if (error || data?.error) throw new Error(error?.message || data?.error || "Falha");
      const qr: string | null = data?.qr || null;
      if (!qr) {
        toast.info("A Whapi não devolveu QR agora. Aguarde 5s e clique de novo.");
      } else {
        setQrImage(qr.startsWith("data:") ? qr : `data:image/png;base64,${qr}`);
        toast.success("QR gerado. Escaneie no WhatsApp.");
      }
      // Polling até virar AUTH
      stopReauthPoll();
      reauthPollRef.current = window.setInterval(async () => {
        await health.refresh();
      }, 3000);
      // Para o polling depois de 3 min como safety
      window.setTimeout(stopReauthPoll, 180_000);
    } catch (e: any) {
      toast.error(e?.message || "Erro ao reautenticar");
    } finally {
      setBusy(null);
    }
  };

  const handleRefreshWebhook = async () => {
    setBusy("webhook");
    try {
      const { data, error } = await supabase.functions.invoke("whapi-proxy", {
        body: { action: "refresh_webhook", payload: {} },
      });
      if (error || data?.error) throw new Error(error?.message || data?.error || "Falha");
      toast.success("Webhook reaplicado na Whapi.");
      await health.refresh();
    } catch (e: any) {
      toast.error(e?.message || "Erro ao aplicar webhook");
    } finally {
      setBusy(null);
    }
  };

  // Para polling quando canal volta a AUTH ou componente desmonta
  useEffect(() => {
    if (health.status === "AUTH" && reauthPollRef.current) {
      stopReauthPoll();
      setQrImage(null);
      toast.success("Canal reconectado ✅");
    }
    return () => { if (!visible) stopReauthPoll(); };
  }, [health.status, visible]);


  return (
    <Card className="border-border">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm flex items-center gap-2">
          <span>Conexão Whapi (Super Admin)</span>
          <Badge variant={meta.tone} className="gap-1">
            {meta.icon}
            {meta.label}
          </Badge>
          {health.checking && (
            <span className="text-[10px] text-muted-foreground">checando…</span>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Diagnóstico ao vivo do canal Whapi */}
        <div className="rounded-md border bg-muted/30 p-3 text-[11px] font-mono space-y-1">
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">Whapi /health (ao vivo)</span>
            <span className="text-muted-foreground">
              {health.lastCheckedAt
                ? new Date(health.lastCheckedAt).toLocaleTimeString()
                : "—"}
            </span>
          </div>
          <div>
            status.code:{" "}
            <span
              className={
                health.statusCode === 3
                  ? "text-green-600 font-bold"
                  : health.statusCode === 2
                  ? "text-yellow-600 font-bold"
                  : "text-destructive font-bold"
              }
            >
              {health.statusCode ?? "?"} ({health.statusText || meta.label})
            </span>
          </div>
          <div>
            user.id:{" "}
            <span className="text-foreground">{health.phone || "—"}</span>
          </div>
          {health.channelId && (
            <div>
              channel_id:{" "}
              <span className="text-foreground">{health.channelId}</span>
            </div>
          )}
          <div>
            webhook:{" "}
            {health.webhookOk === true ? (
              <span className="text-green-600">✅ apontando pro app</span>
            ) : health.webhookOk === false ? (
              <span className="text-destructive">❌ não configurado</span>
            ) : (
              <span className="text-muted-foreground">—</span>
            )}
          </div>
          {health.error && (
            <div className="text-destructive">erro: {health.error}</div>
          )}
        </div>

        {/* Banner específico por motivo — pagamento bloqueado tem prioridade */}
        {health.reasonCode === "unpaid" && (
          <div className="rounded-md border-2 border-destructive bg-destructive/10 p-3 text-xs text-destructive space-y-2">
            <div className="flex items-start gap-2">
              <CreditCard className="h-4 w-4 mt-0.5 shrink-0" />
              <div className="flex-1">
                <div className="font-semibold mb-1">Canal Whapi bloqueado por falta de pagamento</div>
                <div>
                  A Whapi suspendeu este canal. Trocar token ou escanear QR <b>não resolve</b> —
                  regularize o pagamento no painel da Whapi.
                </div>
              </div>
            </div>
            <Button
              size="sm"
              variant="destructive"
              onClick={() => window.open(health.helpUrl || "https://panel.whapi.cloud/billing", "_blank")}
              className="w-full"
            >
              <ExternalLink className="h-3.5 w-3.5 mr-1" />
              Abrir billing da Whapi
            </Button>
          </div>
        )}

        {health.reasonCode === "channel_not_found" && (
          <div className="rounded-md border-2 border-orange-500 bg-orange-500/10 p-3 text-xs text-orange-700 dark:text-orange-300 space-y-2">
            <div className="flex items-start gap-2">
              <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
              <div className="flex-1">
                <div className="font-semibold mb-1">Canal Whapi não existe mais</div>
                <div>O canal foi removido no painel. Crie um canal novo e cole o token abaixo.</div>
              </div>
            </div>
            <Button
              size="sm"
              variant="outline"
              onClick={() => window.open(health.helpUrl || "https://panel.whapi.cloud", "_blank")}
              className="w-full"
            >
              <ExternalLink className="h-3.5 w-3.5 mr-1" />
              Abrir painel Whapi
            </Button>
          </div>
        )}

        {(health.reasonCode === "channel_error" ||
          (health.status !== "AUTH" && !health.reasonCode)) && (
          <div className="rounded-md border-2 border-destructive bg-destructive/10 p-3 text-xs text-destructive space-y-2">
            <div className="flex items-start gap-2">
              <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
              <div className="flex-1">
                <div className="font-semibold mb-1">Canal desautenticado</div>
                <div>
                  Token OK, mas o WhatsApp saiu de "Aparelhos conectados". Clique em
                  <b> Reautenticar canal</b> abaixo, escaneie o QR e aguarde virar
                  <b> AUTH (code=3)</b>.
                </div>
              </div>
            </div>
            <Button
              size="sm"
              variant="destructive"
              onClick={handleReauth}
              disabled={busy === "reauth"}
              className="w-full"
            >
              <QrCode className="h-3.5 w-3.5 mr-1" />
              {busy === "reauth" ? "Gerando QR…" : "Reautenticar canal (1 clique)"}
            </Button>
          </div>
        )}

        {health.webhookOk === false && (
          <div className="rounded-md border border-orange-500/50 bg-orange-500/10 p-3 text-xs text-orange-700 dark:text-orange-300 flex items-center justify-between gap-2">
            <span>Webhook não está configurado na Whapi.</span>
            <Button
              size="sm"
              variant="outline"
              onClick={handleRefreshWebhook}
              disabled={busy === "webhook"}
            >
              {busy === "webhook" ? "Aplicando…" : "Reaplicar webhook"}
            </Button>
          </div>
        )}

        <div className="space-y-2">
          <label className="text-xs font-medium flex items-center gap-1">
            <KeyRound className="h-3.5 w-3.5" /> Atualizar token Whapi
          </label>
          <div className="flex gap-2">
            <Input
              type="password"
              placeholder="Cole o token do painel Whapi"
              value={tokenInput}
              onChange={(e) => setTokenInput(e.target.value)}
              className="font-mono text-xs"
            />
            <Button onClick={handleSaveToken} disabled={busy === "save"} size="sm">
              {busy === "save" ? "Salvando…" : "Salvar"}
            </Button>
          </div>
          <p className="text-[10px] text-muted-foreground">
            Pegue em panel.whapi.cloud → seu canal → Settings → Token.
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button onClick={() => health.refresh()} variant="outline" size="sm" disabled={health.checking}>
            <RefreshCcw className={`h-3.5 w-3.5 mr-1 ${health.checking ? "animate-spin" : ""}`} />
            Verificar status
          </Button>
          <Button onClick={handleReauth} variant="outline" size="sm" disabled={busy === "reauth"}>
            <QrCode className="h-3.5 w-3.5 mr-1" />
            {busy === "reauth" ? "Gerando QR…" : "Reautenticar (Logout + QR)"}
          </Button>
          <Button onClick={handleRequestQr} variant="ghost" size="sm" disabled={busy === "qr"}>
            <QrCode className="h-3.5 w-3.5 mr-1" />
            {busy === "qr" ? "Pedindo…" : "Só pedir QR"}
          </Button>
          <Button onClick={handleLogout} variant="ghost" size="sm" disabled={busy === "logout"}>
            <LogOut className="h-3.5 w-3.5 mr-1" />
            {busy === "logout" ? "Saindo…" : "Só logout"}
          </Button>
        </div>

        <div className="space-y-2">
          <label className="text-xs font-medium flex items-center gap-1">
            <KeyRound className="h-3.5 w-3.5" /> Atualizar token Whapi
          </label>
          <div className="flex gap-2">
            <Input
              type="password"
              placeholder="Cole o token do painel Whapi"
              value={tokenInput}
              onChange={(e) => setTokenInput(e.target.value)}
              className="font-mono text-xs"
            />
            <Button onClick={handleSaveToken} disabled={busy === "save"} size="sm">
              {busy === "save" ? "Salvando…" : "Salvar"}
            </Button>
          </div>
          <p className="text-[10px] text-muted-foreground">
            Pegue em panel.whapi.cloud → seu canal → Settings → Token.
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button onClick={() => health.refresh()} variant="outline" size="sm" disabled={health.checking}>
            <RefreshCcw className={`h-3.5 w-3.5 mr-1 ${health.checking ? "animate-spin" : ""}`} />
            Verificar status
          </Button>
          <Button onClick={handleRequestQr} variant="outline" size="sm" disabled={busy === "qr"}>
            <QrCode className="h-3.5 w-3.5 mr-1" />
            {busy === "qr" ? "Pedindo…" : "Pedir QR"}
          </Button>
          <Button onClick={handleLogout} variant="outline" size="sm" disabled={busy === "logout"}>
            <LogOut className="h-3.5 w-3.5 mr-1" />
            {busy === "logout" ? "Saindo…" : "Logout do canal"}
          </Button>
        </div>

        {qrImage && (
          <div className="border rounded-md p-3 flex flex-col items-center gap-2">
            <span className="text-xs text-muted-foreground">Escaneie no WhatsApp do super admin</span>
            <img src={qrImage} alt="QR Whapi" className="w-56 h-56 object-contain" />
          </div>
        )}

        {/* Histórico de conversas */}
        <div className="border-t pt-4 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-sm font-medium">
              <History className="h-4 w-4" />
              Histórico de conversas do WhatsApp
            </div>
            {backfillStatus?.state && (
              <Badge
                variant={
                  backfillStatus.state === "running"
                    ? "secondary"
                    : backfillStatus.state === "error"
                    ? "destructive"
                    : "default"
                }
                className="text-[10px]"
              >
                {backfillStatus.state}
              </Badge>
            )}
          </div>
          <p className="text-[11px] text-muted-foreground">
            Puxa todos os chats e mensagens da instância Whapi para a aba <b>Conversas</b>.
            Leads novos entram com o bot pausado (contato manual). Clientes já vindos
            do iGreen são ignorados. Rodar mais de uma vez não duplica.
          </p>

          {backfillStatus?.stats && (
            <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-[11px] text-muted-foreground bg-muted/40 rounded-md p-2">
              <div>Chats processados: <b className="text-foreground">{backfillStatus.stats.chats_processed ?? 0}</b></div>
              <div>Mensagens importadas: <b className="text-foreground">{backfillStatus.stats.messages_inserted ?? 0}</b></div>
              <div>Leads criados: <b className="text-foreground">{backfillStatus.stats.customers_created ?? 0}</b></div>
              <div>Reaproveitados: <b className="text-foreground">{backfillStatus.stats.customers_reused ?? 0}</b></div>
              <div>Ignorados (iGreen): <b className="text-foreground">{backfillStatus.stats.chats_skipped_existing_igreen ?? 0}</b></div>
              <div>Grupos ignorados: <b className="text-foreground">{backfillStatus.stats.chats_skipped_group ?? 0}</b></div>
              {backfillStatus.stats.last_chat && (
                <div className="col-span-2">Último chat: <span className="font-mono text-foreground">{backfillStatus.stats.last_chat}</span></div>
              )}
              {backfillStatus.stats.errors?.length > 0 && (
                <div className="col-span-2 text-destructive">
                  Erros: {backfillStatus.stats.errors.length} (últimos: {backfillStatus.stats.errors.slice(-2).join(" | ")})
                </div>
              )}
            </div>
          )}

          <div className="flex gap-2">
            <Button
              onClick={handleBackfill}
              size="sm"
              disabled={busy === "backfill" || backfillStatus?.state === "running"}
            >
              <Download className="h-3.5 w-3.5 mr-1" />
              {backfillStatus?.state === "running"
                ? "Rodando…"
                : busy === "backfill"
                ? "Iniciando…"
                : "Importar histórico completo"}
            </Button>
            <Button onClick={fetchBackfillStatus} variant="outline" size="sm">
              <RefreshCcw className="h-3.5 w-3.5 mr-1" />
              Atualizar status
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
