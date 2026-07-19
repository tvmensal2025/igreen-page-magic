import { useEffect, useState } from "react";
import { Facebook, CheckCircle2, AlertCircle, Loader2, Wallet, RefreshCw, Settings2, ShieldCheck, KeyRound, Zap, Search, ArrowRightLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { getPlatformFacebookStatus, listFacebookAssets, selectFacebookAssets, startFacebookOAuth, type FbAssets, type PlatformFacebookStatus } from "@/services/facebookAds";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

interface PlatformBalance {
  connected: boolean;
  currency?: string;
  balance_cents?: number;
  amount_spent_cents?: number;
  system_spend_cents?: number;
  system_charged_cents?: number;
  lifetime_amount_spent_cents?: number;
  delta_unsynced_cents?: number;
  spend_cap_cents?: number;
  available_cents?: number;
  has_funding?: boolean;
  account_status?: number | null;
  last_system_sync_at?: string | null;
  permissions?: {
    granted: string[];
    declined: string[];
    missing: string[];
    all_ok: boolean;
  };
  error?: string;
}

function fmt(cents: number | undefined, currency = "BRL") {
  if (cents == null || !Number.isFinite(cents)) return "—";
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency }).format(cents / 100);
}

export function PlatformFacebookCard() {
  const { toast } = useToast();
  const confirm = useConfirm();
  const [status, setStatus] = useState<PlatformFacebookStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [balance, setBalance] = useState<PlatformBalance | null>(null);
  const [loadingBalance, setLoadingBalance] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [assetsOpen, setAssetsOpen] = useState(false);
  const [assetsLoading, setAssetsLoading] = useState(false);
  const [savingAssets, setSavingAssets] = useState(false);
  const [assets, setAssets] = useState<FbAssets | null>(null);
  const [manualMode, setManualMode] = useState(false);
  const [selAdAccount, setSelAdAccount] = useState("");
  const [selPage, setSelPage] = useState("");
  const [selPixel, setSelPixel] = useState("");
  const [manualAdAccount, setManualAdAccount] = useState("");
  const [manualPage, setManualPage] = useState("");
  const [manualPixel, setManualPixel] = useState("");
  const [ensuringPixel, setEnsuringPixel] = useState(false);
  const [syncingAll, setSyncingAll] = useState(false);
  const [syncReport, setSyncReport] = useState<any>(null);
  const [reportOpen, setReportOpen] = useState(false);
  const [diagOpen, setDiagOpen] = useState(false);
  const [diagLoading, setDiagLoading] = useState(false);
  const [diagData, setDiagData] = useState<any>(null);
  const [migratingId, setMigratingId] = useState<string | null>(null);
  const [migratingAll, setMigratingAll] = useState(false);

  async function loadDiagnose() {
    setDiagOpen(true);
    setDiagLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("facebook-diagnose-pixels", { body: {} });
      if (error) throw error;
      if ((data as any)?.error) throw new Error((data as any).error);
      setDiagData(data);
    } catch (e: any) {
      toast({ title: "Falha ao diagnosticar", description: e?.message, variant: "destructive" });
    } finally {
      setDiagLoading(false);
    }
  }

  async function migrateOne(adsetId: string) {
    const ok = await confirm({
      title: "Duplicar adset e corrigir o pixel?",
      description: "A Meta não permite trocar o pixel deste adset diretamente. A operação duplicará o adset, pausará o original e reiniciará o aprendizado no novo conjunto.",
      confirmText: "Confirmar reset",
      tone: "info",
    });
    if (!ok) return;
    setMigratingId(adsetId);
    try {
      const { data, error } = await supabase.functions.invoke("facebook-migrate-adset-pixel", {
        body: { adset_id: adsetId, confirm_learning_reset: true },
      });
      if (error) throw error;
      if ((data as any)?.error) throw new Error((data as any).error);
      toast({ title: "Adset migrado", description: `Novo adset: ${(data as any)?.new_adset_id || "—"}` });
      await loadDiagnose();
    } catch (e: any) {
      toast({ title: "Falha ao migrar", description: e?.message, variant: "destructive" });
    } finally {
      setMigratingId(null);
    }
  }

  async function migrateAllWrong() {
    if (!diagData?.adsets) return;
    const wrong = diagData.adsets.filter((a: any) => a.adset_id && a.is_correct === false);
    if (wrong.length === 0) return;
    const ok = await confirm({
      title: `Duplicar ${wrong.length} adset(s) e corrigir o pixel?`,
      description: "Cada adset será duplicado, o original será pausado e o aprendizado será reiniciado no novo conjunto. Confirme somente se esse reset for realmente necessário.",
      confirmText: "Confirmar resets",
      tone: "info",
    });
    if (!ok) return;
    setMigratingAll(true);
    let okCount = 0, failCount = 0;
    for (const a of wrong) {
      try {
        const { data, error } = await supabase.functions.invoke("facebook-migrate-adset-pixel", {
          body: { adset_id: a.adset_id, confirm_learning_reset: true },
        });
        if (error || (data as any)?.error) throw new Error(error?.message || (data as any).error);
        okCount++;
      } catch {
        failCount++;
      }
    }
    setMigratingAll(false);
    toast({ title: "Migração concluída", description: `${okCount} ok · ${failCount} falhas` });
    await loadDiagnose();
  }

  async function syncAll() {
    setSyncingAll(true);
    try {
      const { data, error } = await supabase.functions.invoke("facebook-platform-sync-all", { body: {} });
      if (error) throw error;
      setSyncReport(data);
      setReportOpen(true);
      await loadStatus();
    } catch (e: any) {
      toast({ title: "Falha ao sincronizar", description: e?.message, variant: "destructive" });
    } finally {
      setSyncingAll(false);
    }
  }

  async function ensurePixel() {
    setEnsuringPixel(true);
    try {
      const { data, error } = await supabase.functions.invoke("facebook-ensure-pixel", { body: {} });
      if (error) throw error;
      if ((data as any)?.error) throw new Error((data as any).error);
      toast({
        title: (data as any)?.created
          ? "Pixel igreen-oficial-remarketing criado ✅"
          : (data as any)?.ok
            ? "Pixel igreen-oficial-remarketing pronto ✅"
            : "Falha no pixel",
        description: (data as any)?.message || (data as any)?.page_link_note || `ID: ${(data as any)?.pixel_id}`,
        variant: (data as any)?.ok === false ? "destructive" : undefined,
      });
      await loadStatus();
    } catch (e: any) {
      toast({ title: "Falha ao garantir pixel", description: e?.message, variant: "destructive" });
    } finally {
      setEnsuringPixel(false);
    }
  }


  async function openOAuthInNewTab(mode: "connect" | "switch" | "rerequest") {
    const popup = window.open("about:blank", "fb_oauth", "width=600,height=750");
    if (!popup) {
      toast({
        title: "Pop-up bloqueado",
        description: "Permita pop-ups deste site no navegador e tente de novo.",
        variant: "destructive",
      });
      return;
    }
    setConnecting(true);
    try {
      const res = await startFacebookOAuth({ scope: "platform", mode });
      popup.location.href = res.url;

      const started = Date.now();
      const prev = JSON.stringify({
        a: status?.ad_account_id,
        p: status?.pixel_id,
        v: status?.token_expires_at, u: status?.fb_user_name,
      });
      const interval = setInterval(async () => {
        if (popup.closed || Date.now() - started > 5 * 60_000) {
          clearInterval(interval);
          setConnecting(false);
          await loadStatus();
          return;
        }
        try {
          const s = await getPlatformFacebookStatus();
          const now = JSON.stringify({
            a: s?.ad_account_id,
            p: s?.pixel_id,
            v: s?.token_expires_at, u: s?.fb_user_name,
          });
          if (now !== prev) {
            setStatus(s);
            if (s?.configured) loadBalance();
            clearInterval(interval);
            setConnecting(false);
            try { popup.close(); } catch { /* ignore */ }
          }
        } catch { /* keep polling */ }
      }, 3000);
    } catch (e: any) {
      try { popup.close(); } catch { /* ignore */ }
      toast({ title: "Erro ao iniciar OAuth", description: e?.message, variant: "destructive" });
      setConnecting(false);
    }
  }

  async function loadBalance() {
    setLoadingBalance(true);
    try {
      const { data, error } = await supabase.functions.invoke("facebook-platform-balance", { body: {} });
      if (error) throw error;
      setBalance(data as PlatformBalance);
    } catch (e: any) {
      toast({ title: "Erro ao buscar saldo", description: e?.message, variant: "destructive" });
    } finally {
      setLoadingBalance(false);
    }
  }

  async function loadStatus() {
    const s = await getPlatformFacebookStatus();
    setStatus(s);
    if (s?.configured) loadBalance();
  }

  async function openAssets() {
    setAssetsOpen(true);
    setAssetsLoading(true);
    setManualMode(false);
    try {
      const a = await listFacebookAssets({ scope: "platform" });
      setAssets(a);
      setSelAdAccount(status?.ad_account_id || "");
      setSelPage(status?.page_id || "");
      setSelPixel(status?.pixel_id || "");
      setManualAdAccount(status?.ad_account_id || "");
      setManualPage(status?.page_id || "");
      setManualPixel(status?.pixel_id || "");
      if ((a.ad_accounts?.length || 0) === 0 && (a.pages?.length || 0) === 0) setManualMode(true);
    } catch (e: any) {
      toast({ title: "Falha ao listar assets", description: e?.message, variant: "destructive" });
      setManualMode(true);
    } finally {
      setAssetsLoading(false);
    }
  }

  async function saveAssets() {
    setSavingAssets(true);
    try {
      await selectFacebookAssets({
        scope: "platform",
        ad_account_id: (manualMode ? manualAdAccount : selAdAccount).trim() || null,
        page_id: (manualMode ? manualPage : selPage).trim() || null,
        pixel_id: (manualMode ? manualPixel : selPixel).trim() || null,
      });
      toast({ title: "Conta principal atualizada" });
      setAssetsOpen(false);
      await loadStatus();
    } catch (e: any) {
      toast({ title: "Falha ao salvar assets", description: e?.message, variant: "destructive" });
    } finally {
      setSavingAssets(false);
    }
  }

  useEffect(() => {
    (async () => {
      try {
        await loadStatus();
      }
      finally { setLoading(false); }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="rounded-2xl border border-border/60 bg-card/40 p-6 space-y-4">
      <header className="flex items-center gap-3">
        <Facebook className="w-6 h-6 text-primary" />
        <div>
          <h3 className="font-bold text-foreground text-lg">Conta Facebook da plataforma</h3>
          <p className="text-sm text-muted-foreground">Uma única conta usada por todos os consultores para anunciar.</p>
        </div>
      </header>

      {loading ? (
        <div className="flex justify-center py-6"><Loader2 className="w-5 h-5 animate-spin text-primary" /></div>
      ) : status?.connected ? (
        <>
          <div className={`rounded-xl border p-4 space-y-2 ${status.configured ? "bg-primary/10 border-primary/20" : "bg-warning/10 border-warning/30"}`}>
            <div className={`flex items-center gap-2 flex-wrap ${status.configured ? "text-primary" : "text-warning"}`}>
              {status.configured ? <CheckCircle2 className="w-5 h-5" /> : <AlertCircle className="w-5 h-5" />}
              <span className="font-medium">{status.configured ? "Conta principal configurada" : "Facebook conectado — escolha a conta de anúncios"}</span>
              <Button size="sm" variant="outline" onClick={openAssets} disabled={connecting} className="ml-auto gap-1.5">
                <Settings2 className="w-3.5 h-3.5" />
                Definir principal
              </Button>
              <Button size="sm" variant="outline" onClick={() => openOAuthInNewTab("switch")} disabled={connecting} className="ml-auto gap-1.5">
                {connecting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
                Reconectar / trocar conta
              </Button>
            </div>
            <dl className="grid grid-cols-2 gap-2 text-sm mt-2">
              <Field label="Conta de anúncios" value={status.ad_account_name || status.ad_account_id} />
              <Field label="Página" value={status.page_name || status.page_id} />
              <Field label="Pixel" value={status.pixel_id || "—"} />
              <Field label="Usuário FB" value={status.fb_user_name || "—"} />
            </dl>
            <div className="flex flex-wrap gap-2 pt-2">
              <Button size="sm" onClick={syncAll} disabled={syncingAll} className="gap-1.5">
                {syncingAll ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Zap className="w-3.5 h-3.5" />}
                Sincronizar tudo
              </Button>
              <Button size="sm" variant="secondary" onClick={ensurePixel} disabled={ensuringPixel} className="gap-1.5">
                {ensuringPixel ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Settings2 className="w-3.5 h-3.5" />}
                Criar pixel igreen-oficial-remarketing
              </Button>
              <Button size="sm" variant="outline" onClick={loadDiagnose} className="gap-1.5">
                <Search className="w-3.5 h-3.5" />
                Diagnosticar Pixels dos anúncios
              </Button>
            </div>
          </div>


          {status.configured && <div className="rounded-xl bg-card/60 border border-border/60 p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-foreground">
                <Wallet className="w-5 h-5 text-primary" />
                <span className="font-medium">Saldo da conta de anúncios</span>
              </div>
              <Button size="sm" variant="ghost" onClick={loadBalance} disabled={loadingBalance} className="gap-1.5">
                {loadingBalance ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
                Atualizar
              </Button>
            </div>
            {loadingBalance && !balance ? (
              <div className="flex justify-center py-4"><Loader2 className="w-5 h-5 animate-spin text-primary" /></div>
            ) : balance?.error ? (
              <p className="text-sm text-destructive">{balance.error}</p>
            ) : balance ? (
              <>
                <div className="grid grid-cols-2 gap-3">
                  <Stat label="Disponível agora" value={fmt(balance.available_cents, balance.currency)} highlight />
                  <Stat label="Gasto sincronizado" value={fmt(balance.amount_spent_cents, balance.currency)} />
                  <Stat label="Limite (spend cap)" value={balance.spend_cap_cents ? fmt(balance.spend_cap_cents, balance.currency) : "Sem limite"} />
                  <Stat label="Saldo pré-pago" value={fmt(balance.balance_cents, balance.currency)} />
                </div>
                <div className="grid gap-1 text-xs text-muted-foreground">
                  <p>Status Meta: <span className="text-foreground">{balance.account_status === 1 ? "Ativa" : balance.account_status === 9 ? "Em pré-pagamento" : balance.account_status ? `Código ${balance.account_status}` : "—"}</span></p>
                  <p>Histórico total da conta Meta: <span className="text-foreground">{fmt(balance.lifetime_amount_spent_cents, balance.currency)}</span></p>
                  <p>Última sincronização do sistema: <span className="text-foreground">{balance.last_system_sync_at ? new Date(balance.last_system_sync_at).toLocaleString("pt-BR") : "—"}</span></p>
                </div>
                {(balance.delta_unsynced_cents ?? 0) > 50 && (
                  <div className="rounded-lg bg-warning/10 border border-warning/30 p-2.5 text-xs space-y-0.5">
                    <p className="font-medium text-warning flex items-center gap-1.5">
                      <AlertCircle className="w-3.5 h-3.5" /> Δ não sincronizado: {fmt(balance.delta_unsynced_cents, balance.currency)}
                    </p>
                    <p className="text-muted-foreground">A Meta já gastou esse valor que o sistema ainda não debitou. Próximo sync cobre.</p>
                  </div>
                )}
                {!balance.has_funding && (
                  <p className="text-xs text-warning flex items-center gap-1.5">
                    <AlertCircle className="w-3.5 h-3.5" /> Sem forma de pagamento configurada na Meta.
                  </p>
                )}
              </>
            ) : null}
          </div>}

          {balance?.permissions && (
            <div className="rounded-xl bg-card/60 border border-border/60 p-4 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-foreground">
                  <ShieldCheck className={`w-5 h-5 ${balance.permissions.all_ok ? "text-primary" : "text-warning"}`} />
                  <span className="font-medium">Permissões Meta {balance.permissions.all_ok ? "(todas concedidas)" : `(${balance.permissions.missing.length} faltando)`}</span>
                </div>
                {!balance.permissions.all_ok && (
                  <Button size="sm" variant="outline" onClick={() => openOAuthInNewTab("rerequest")} disabled={connecting} className="gap-1.5">
                    {connecting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <KeyRound className="w-3.5 h-3.5" />}
                    Solicitar permissões faltando
                  </Button>
                )}
              </div>
              {balance.permissions.missing.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {balance.permissions.missing.map((p) => (
                    <Badge key={p} variant="outline" className="border-warning/40 text-warning text-xs">{p}</Badge>
                  ))}
                </div>
              )}
              <p className="text-xs text-muted-foreground">
                Concedidas: {balance.permissions.granted.length} · Negadas: {balance.permissions.declined.length}
                {!balance.permissions.all_ok && " · Algumas exigem App Review aprovado da Meta para funcionar com usuários fora da BM."}
              </p>
            </div>
          )}
        </>
      ) : (
        <div className="rounded-xl bg-warning/10 border border-warning/30 p-4 space-y-3">
          <div className="flex items-start gap-2 text-sm">
            <AlertCircle className="w-5 h-5 text-warning flex-shrink-0 mt-0.5" />
            <div>
              <p className="font-medium text-foreground">Nenhuma conta Facebook conectada</p>
              <p className="text-muted-foreground">Conecte a conta Facebook Business da plataforma para que os consultores possam criar campanhas.</p>
            </div>
          </div>
          <Button onClick={() => openOAuthInNewTab("connect")} disabled={connecting} className="w-full gap-2">
            {connecting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Facebook className="w-4 h-4" />}
            Conectar Facebook Business
          </Button>
        </div>
      )}

      <Dialog open={assetsOpen} onOpenChange={setAssetsOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><Settings2 className="w-4 h-4 text-primary" /> Definir conta principal</DialogTitle>
          </DialogHeader>
          {assetsLoading || !assets ? (
            <div className="flex justify-center py-8"><Loader2 className="w-5 h-5 animate-spin" /></div>
          ) : (
            <div className="space-y-4">
              {(assets.errors?.ad_accounts || assets.errors?.pages) && (
                <div className="text-xs rounded-md border border-warning/30 bg-warning/10 p-2 text-warning space-y-1">
                  {assets.errors?.ad_accounts && <div>Contas: {assets.errors.ad_accounts}</div>}
                  {assets.errors?.pages && <div>Páginas: {assets.errors.pages}</div>}
                </div>
              )}
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">{manualMode ? "Modo manual ativo" : "Selecionando da lista do Facebook"}</span>
                <button type="button" onClick={() => setManualMode(m => !m)} className="text-primary hover:underline">
                  {manualMode ? "Voltar para lista" : "Inserir IDs manualmente"}
                </button>
              </div>
              {manualMode ? (
                <div className="space-y-3">
                  <div><Label className="text-xs">ID da Conta de Anúncios *</Label><Input placeholder="act_1234567890" value={manualAdAccount} onChange={e => setManualAdAccount(e.target.value)} /></div>
                  <div><Label className="text-xs">ID da Página *</Label><Input placeholder="1234567890123456" value={manualPage} onChange={e => setManualPage(e.target.value)} /></div>
                  <div><Label className="text-xs">ID do Pixel (opcional)</Label><Input placeholder="1234567890" value={manualPixel} onChange={e => setManualPixel(e.target.value)} /></div>
                </div>
              ) : (
                <div className="space-y-3">
                  <div><Label className="text-xs">Conta de Anúncios *</Label><Select value={selAdAccount} onValueChange={(v) => { setSelAdAccount(v); setSelPixel(""); }}><SelectTrigger><SelectValue placeholder="Escolha uma conta" /></SelectTrigger><SelectContent>{assets.ad_accounts.map(a => <SelectItem key={a.id} value={a.id}>{a.name} ({a.currency}) — {a.id}</SelectItem>)}</SelectContent></Select></div>
                  <div><Label className="text-xs">Página *</Label><Select value={selPage} onValueChange={setSelPage}><SelectTrigger><SelectValue placeholder="Escolha uma página" /></SelectTrigger><SelectContent>{assets.pages.map(p => <SelectItem key={p.id} value={p.id}>{p.name}{p.instagram_username ? ` · @${p.instagram_username}` : ""}</SelectItem>)}</SelectContent></Select></div>
                  {selAdAccount && (assets.pixels_by_ad_account[selAdAccount] || []).length > 0 && <div><Label className="text-xs">Pixel (opcional)</Label><Select value={selPixel} onValueChange={setSelPixel}><SelectTrigger><SelectValue placeholder="Sem pixel" /></SelectTrigger><SelectContent>{(assets.pixels_by_ad_account[selAdAccount] || []).map(p => <SelectItem key={p.id} value={p.id}>{p.name} — {p.id}</SelectItem>)}</SelectContent></Select></div>}
                </div>
              )}
            </div>
          )}
          <DialogFooter>
            <Button variant="ghost" onClick={() => setAssetsOpen(false)} disabled={savingAssets}>Cancelar</Button>
            <Button onClick={saveAssets} disabled={savingAssets || assetsLoading}>
              {savingAssets ? <><Loader2 className="w-4 h-4 mr-1 animate-spin" /> Salvando...</> : "Salvar principal"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={reportOpen} onOpenChange={setReportOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Zap className="w-4 h-4 text-primary" /> Relatório de Sincronização
            </DialogTitle>
          </DialogHeader>
          {syncReport && (
            <div className="space-y-3 text-sm">
              <ReportRow
                title="Pixel ↔ Conta de anúncios"
                ok={syncReport.pixel_check?.ok}
                msg={syncReport.pixel_check?.message || syncReport.pixel_check?.error}
                actionHref={
                  syncReport.pixel_check?.ok
                    ? undefined
                    : "https://business.facebook.com/settings/pixels/1521037349653769"
                }
                actionLabel="Abrir Pixel no Business Manager"
              />
              <ReportRow
                title="Saldo da conta"
                ok={syncReport.balance?.ok}
                msg={syncReport.balance?.ok
                  ? `Disponível: ${((syncReport.balance.available_cents || 0) / 100).toLocaleString("pt-BR", { style: "currency", currency: syncReport.balance.currency || "BRL" })} · Gasto: ${((syncReport.balance.amount_spent_cents || 0) / 100).toLocaleString("pt-BR", { style: "currency", currency: syncReport.balance.currency || "BRL" })}`
                  : syncReport.balance?.error}
              />
              <ReportRow
                title="Métricas de campanhas"
                ok={syncReport.metrics?.ok}
                msg={syncReport.metrics?.ok
                  ? `${syncReport.metrics?.synced ?? 0} campanhas atualizadas`
                  : syncReport.metrics?.error}
              />
              <ReportRow
                title="Audiências + Lookalike"
                ok={syncReport.audiences?.ok}
                msg={syncReport.audiences?.ok
                  ? `${syncReport.audiences?.uploaded ?? 0} clientes enviados · Lookalike: ${syncReport.audiences?.lal_status || "—"}`
                  : [syncReport.audiences?.error, syncReport.audiences?.hint].filter(Boolean).join(" — ") || "Falha no sync de audiências"}
              />
            </div>
          )}
          <DialogFooter>
            <Button onClick={() => setReportOpen(false)}>Fechar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={diagOpen} onOpenChange={setDiagOpen}>
        <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Search className="w-4 h-4 text-primary" /> Diagnóstico de Pixels dos anúncios
            </DialogTitle>
          </DialogHeader>
          {diagLoading ? (
            <div className="flex justify-center py-10"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>
          ) : diagData ? (
            <div className="space-y-3">
              <div className="rounded-lg bg-primary/5 border border-primary/20 p-3 text-sm space-y-1">
                <p><strong>Pixel correto:</strong> {diagData.correct_pixel_name} (<code className="text-xs">{diagData.correct_pixel_id}</code>)</p>
                <p>{diagData.total_adsets} adset(s) ativo(s) · <span className={diagData.wrong_count > 0 ? "text-warning font-medium" : "text-primary"}>{diagData.wrong_count} com pixel errado/ausente</span></p>
              </div>
              {diagData.wrong_count > 0 && (
                <Button onClick={migrateAllWrong} disabled={migratingAll} className="w-full gap-2">
                  {migratingAll ? <Loader2 className="w-4 h-4 animate-spin" /> : <ArrowRightLeft className="w-4 h-4" />}
                  Migrar TODOS para o pixel correto ({diagData.wrong_count})
                </Button>
              )}
              <div className="space-y-2">
                {(diagData.adsets || []).map((a: any, i: number) => (
                  <div key={a.adset_id || i} className={`rounded-lg border p-3 text-sm ${a.is_correct ? "border-primary/20 bg-primary/5" : "border-warning/30 bg-warning/5"}`}>
                    {a.error ? (
                      <p className="text-destructive text-xs">⚠ {a.campaign_name}: {a.error}</p>
                    ) : (
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            {a.is_correct ? <CheckCircle2 className="w-4 h-4 text-primary flex-shrink-0" /> : <AlertCircle className="w-4 h-4 text-warning flex-shrink-0" />}
                            <span className="font-medium truncate">{a.adset_name}</span>
                            <Badge variant="outline" className="text-xs">{a.effective_status}</Badge>
                          </div>
                          <p className="text-xs text-muted-foreground mt-1 truncate">Campanha: {a.campaign_name}</p>
                          <p className="text-xs mt-1">
                            Pixel: {a.has_pixel ? (
                              <><span className={a.is_correct ? "text-primary" : "text-warning"}>{a.current_pixel_name}</span> <code className="text-muted-foreground">({a.current_pixel_id})</code></>
                            ) : (
                              <span className="text-destructive">Sem pixel</span>
                            )}
                          </p>
                        </div>
                        {!a.is_correct && (
                          <Button size="sm" variant="outline" disabled={migratingId === a.adset_id || migratingAll} onClick={() => migrateOne(a.adset_id)} className="gap-1.5 flex-shrink-0">
                            {migratingId === a.adset_id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ArrowRightLeft className="w-3.5 h-3.5" />}
                            Migrar
                          </Button>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ) : null}
          <DialogFooter>
            <Button variant="ghost" onClick={loadDiagnose} disabled={diagLoading} className="gap-1.5">
              <RefreshCw className="w-3.5 h-3.5" /> Recarregar
            </Button>
            <Button onClick={() => setDiagOpen(false)}>Fechar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function ReportRow({
  title,
  ok,
  msg,
  actionHref,
  actionLabel,
}: {
  title: string;
  ok?: boolean;
  msg?: string;
  actionHref?: string;
  actionLabel?: string;
}) {
  return (
    <div className={`rounded-lg border p-3 ${ok ? "border-primary/30 bg-primary/5" : "border-warning/30 bg-warning/5"}`}>
      <div className="flex items-center gap-2 font-medium">
        {ok ? <CheckCircle2 className="w-4 h-4 text-primary" /> : <AlertCircle className="w-4 h-4 text-warning" />}
        {title}
      </div>
      {msg && <p className="text-xs text-muted-foreground mt-1 break-words">{msg}</p>}
      {actionHref && actionLabel && (
        <a
          href={actionHref}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-block mt-2 text-xs font-medium text-primary hover:underline"
        >
          {actionLabel}
        </a>
      )}
    </div>
  );
}

function Field({ label, value }: { label: string; value: string | null }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-foreground truncate">{value || "—"}</dd>
    </div>
  );
}

function Stat({ label, value, highlight = false }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className={`rounded-lg p-3 ${highlight ? "bg-primary/15 border border-primary/30" : "bg-secondary/30 border border-border/40"}`}>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={`font-bold ${highlight ? "text-primary text-lg" : "text-foreground"}`}>{value}</p>
    </div>
  );
}