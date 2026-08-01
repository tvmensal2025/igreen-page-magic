import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "@/hooks/use-toast";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { AlertTriangle, ShieldCheck, RefreshCw, Ban, RotateCcw } from "lucide-react";

interface InstanceRow {
  instance_name: string;
  status: string | null;
  connected_phone: string | null;
  manual_review_required: boolean | null;
  fatal_lock_until: string | null;
  recovery_mode_until: string | null;
  consultant_id: string | null;
}

export function WhatsAppInstanceHealthCard() {
  const confirm = useConfirm();
  const [rows, setRows] = useState<InstanceRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("whatsapp_instances")
      .select("instance_name,status,connected_phone,manual_review_required,fatal_lock_until,recovery_mode_until,consultant_id")
      .order("updated_at", { ascending: false })
      .limit(50);
    if (error) {
      toast({ title: "Erro ao carregar instâncias", description: error.message, variant: "destructive" });
    } else {
      setRows((data as InstanceRow[]) ?? []);
    }
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const markBanned = async (instance: string) => {
    const ok = await confirm({
      title: `Marcar ${instance} como banida?`,
      description: "Envios serão pausados até você destravar manualmente.",
      confirmText: "Marcar como banida",
      cancelText: "Cancelar",
      tone: "danger",
    });
    if (!ok) return;
    setBusy(instance);
    const { data, error } = await supabase.rpc("admin_mark_instance_banned", { p_instance: instance });
    setBusy(null);
    if (error) toast({ title: "Falha", description: error.message, variant: "destructive" });
    else { toast({ title: "Instância marcada como banida" }); load(); }
  };

  const clearBan = async (instance: string) => {
    const reason = window.prompt(
      `Motivo da liberação de ${instance} (mín. 5 caracteres).\n` +
        `Só libere se o chip estiver ok no WhatsApp oficial do celular.`,
      "Chip validado no app oficial — liberar QR",
    );
    if (reason == null) return;
    if (reason.trim().length < 5) {
      toast({ title: "Motivo obrigatório", description: "Escreva pelo menos 5 caracteres.", variant: "destructive" });
      return;
    }
    setBusy(instance);
    // admin_clear_fatal_lock limpa manual_review + fatal_lock_until e registra auditoria.
    const { error: fatalErr } = await supabase.rpc("admin_clear_fatal_lock", {
      p_instance: instance,
      p_reason: reason.trim(),
    });
    if (fatalErr) {
      // Fallback: admin_clear_ban também zera o hard-lock (painel legado).
      const { error } = await supabase.rpc("admin_clear_ban", { p_instance: instance });
      setBusy(null);
      if (error) toast({ title: "Falha", description: fatalErr.message || error.message, variant: "destructive" });
      else { toast({ title: "Instância destravada" }); load(); }
      return;
    }
    setBusy(null);
    toast({ title: "Hard-lock liberado", description: "Consultor pode gerar QR (Reconectar / Conectar)." });
    load();
  };

  const recreate = async (instance: string) => {
    const ok = await confirm({
      title: `Recriar ${instance}?`,
      description:
        "Apaga a sessão no Evolution e gera QR novo (mesmo nome). Use só se o chip estiver saudável no app oficial. Após ban/403, NÃO reconecte — aguarde e peça liberação do hard-lock.",
      confirmText: "Recriar instância",
      cancelText: "Cancelar",
      tone: "danger",
    });
    if (!ok) return;
    setBusy(instance);
    const { data, error } = await supabase.functions.invoke("evolution-instance-reconnect", {
      body: { instanceName: instance, recreate: true },
    });
    setBusy(null);
    if (error) toast({ title: "Falha ao recriar", description: error.message, variant: "destructive" });
    else {
      toast({
        title: "Instância recriada (nome fixo)",
        description: `${(data as any)?.new_instance_name ?? instance}. Peça ao consultor para escanear o QR.`,
      });
      load();
    }
  };

  const isLocked = (r: InstanceRow) =>
    !!r.manual_review_required ||
    (!!r.fatal_lock_until && new Date(r.fatal_lock_until) > new Date());

  return (
    <Card className="border-border/50">
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-base flex items-center gap-2">
          <ShieldCheck className="w-4 h-4 text-primary" />
          Saúde das instâncias WhatsApp
        </CardTitle>
        <Button variant="ghost" size="sm" onClick={load} disabled={loading}>
          <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
        </Button>
      </CardHeader>
      <CardContent className="space-y-2">
        {loading && <p className="text-sm text-muted-foreground">Carregando…</p>}
        {!loading && rows.length === 0 && (
          <p className="text-sm text-muted-foreground">Nenhuma instância encontrada.</p>
        )}
        {rows.map((r) => {
          const locked = isLocked(r);
          const recovery = r.recovery_mode_until && new Date(r.recovery_mode_until) > new Date();
          return (
            <div
              key={r.instance_name}
              className={`flex items-center justify-between gap-3 p-3 rounded-lg border ${locked ? "border-destructive/40 bg-destructive/5" : "border-border/40 bg-card/40"}`}
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-mono text-xs truncate">{r.instance_name}</span>
                  <Badge variant={r.status === "connected" ? "default" : "secondary"} className="text-[10px]">
                    {r.status ?? "?"}
                  </Badge>
                  {locked && (
                    <Badge variant="destructive" className="text-[10px] gap-1">
                      <AlertTriangle className="w-3 h-3" /> banida
                    </Badge>
                  )}
                  {recovery && (
                    <Badge variant="outline" className="text-[10px]">recovery</Badge>
                  )}
                </div>
                <p className="text-[11px] text-muted-foreground mt-0.5">
                  {r.connected_phone ?? "sem número"}
                </p>
              </div>
              <div className="flex gap-2 shrink-0 flex-wrap justify-end">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => recreate(r.instance_name)}
                  disabled={busy === r.instance_name}
                  title="Deleta esta instância no WhatsApp e cria uma nova (mesmo consultor). Usar quando o QR não autentica mais."
                >
                  <RotateCcw className="w-3.5 h-3.5 mr-1" />
                  Recriar
                </Button>
                {locked ? (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => clearBan(r.instance_name)}
                    disabled={busy === r.instance_name}
                    title="Libera hard-lock (403/ban) para o consultor poder gerar QR de novo"
                  >
                    <ShieldCheck className="w-3.5 h-3.5 mr-1" />
                    Liberar QR
                  </Button>
                ) : (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => markBanned(r.instance_name)}
                    disabled={busy === r.instance_name}
                    className="text-destructive hover:text-destructive"
                  >
                    <Ban className="w-3.5 h-3.5 mr-1" />
                    Marcar banida
                  </Button>
                )}
              </div>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
