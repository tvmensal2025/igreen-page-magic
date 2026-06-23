import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useWhapiHealth, type WhapiHealthStatus } from "@/hooks/useWhapiHealth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "sonner";
import { RefreshCcw, KeyRound, QrCode, LogOut, AlertTriangle, CheckCircle2, CreditCard, ExternalLink } from "lucide-react";

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
  const [busy, setBusy] = useState<null | "save" | "qr" | "logout">(null);
  const [qrImage, setQrImage] = useState<string | null>(null);

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
        <div className="grid gap-1 text-xs text-muted-foreground">
          <div>
            Telefone conectado: <span className="font-mono text-foreground">{health.phone || "—"}</span>
          </div>
          {health.channelId && (
            <div>
              Canal: <span className="font-mono text-foreground">{health.channelId}</span>
            </div>
          )}
          {health.error && (
            <div className="text-destructive">Último erro: {health.error}</div>
          )}
        </div>

        {health.status !== "AUTH" && (
          <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-xs text-destructive flex items-start gap-2">
            <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
            <div>
              Canal Whapi está <b>{meta.label}</b>. Atualize o token ou escaneie um novo QR
              para voltar a enviar mensagens — sem precisar tocar em código.
            </div>
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
      </CardContent>
    </Card>
  );
}
