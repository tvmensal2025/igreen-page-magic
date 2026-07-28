import { useEffect, useState } from "react";
import { KeyRound, Loader2, RefreshCw, CheckCircle2, Eye, EyeOff, Plus, Trash2, Pencil, X } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { runIgreenSync } from "@/lib/igreenSync";
import { formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";

interface IGreenAccountRow {
  id: string;
  position: number;
  label: string | null;
  portal_email: string;
  igreen_consultor_id: string | null;
  credential_status: string | null;
  credential_checked_at: string | null;
  last_sync_at: string | null;
}

interface AccountStats {
  total: number;
  aprovados: number;
  reprovados: number;
  outros: number;
}

const emptyStats = (): AccountStats => ({ total: 0, aprovados: 0, reprovados: 0, outros: 0 });

function bumpStatus(stats: AccountStats, status: string | null) {
  stats.total += 1;
  if (status === "approved") stats.aprovados += 1;
  else if (status === "rejected") stats.reprovados += 1;
  else stats.outros += 1;
}

/**
 * Card de conexão com o Escritório iGreen. O consultor salva e-mail + senha do
 * portal (escritorio.igreenenergy.com.br); a partir daí a sincronização puxa
 * TODOS os dados dele (clientes, rede, boletos, métricas) via worker green.
 *
 * Suporta MÚLTIPLAS contas iGreen por consultor (ex.: mais de um cadastro no
 * portal). A conta de posição 1 é a principal; o consultor pode adicionar
 * quantas quiser clicando "Adicionar mais uma conta". O sync percorre todas
 * em ordem (1, 2, 3...) automaticamente.
 */
export function IGreenConnectionCard({ userId }: { userId: string }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [lastSync, setLastSync] = useState<string | null>(null);
  const [accounts, setAccounts] = useState<IGreenAccountRow[]>([]);
  const [accountStats, setAccountStats] = useState<Record<string, AccountStats>>({});

  // form de "adicionar conta" (aparece ao clicar no botão)
  const [addingNew, setAddingNew] = useState(false);
  const [newEmail, setNewEmail] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newLabel, setNewLabel] = useState("");
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [savingNew, setSavingNew] = useState(false);

  // edição por conta (abre com "Editar" — e-mail + senha + nome)
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editEmail, setEditEmail] = useState("");
  const [editLabel, setEditLabel] = useState("");
  const [editPassword, setEditPassword] = useState("");
  const [showEditPassword, setShowEditPassword] = useState(false);
  const [savingAccountId, setSavingAccountId] = useState<string | null>(null);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [validatingId, setValidatingId] = useState<string | null>(null);
  const [syncingAccountId, setSyncingAccountId] = useState<string | null>(null);

  const startEdit = (acc: IGreenAccountRow) => {
    setEditingId(acc.id);
    setEditEmail(acc.portal_email || "");
    setEditLabel(acc.label || "");
    setEditPassword("");
    setShowEditPassword(false);
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditEmail("");
    setEditLabel("");
    setEditPassword("");
    setShowEditPassword(false);
  };

  const loadAccountStats = async (accs: IGreenAccountRow[]) => {
    if (!userId || accs.length === 0) {
      setAccountStats({});
      return;
    }
    const { data } = await supabase
      .from("customers")
      .select("status, igreen_account_id, registered_by_igreen_id")
      .eq("consultant_id", userId);

    const byId: Record<string, AccountStats> = {};
    const byConsultor: Record<string, string> = {};
    for (const a of accs) {
      byId[a.id] = emptyStats();
      if (a.igreen_consultor_id) byConsultor[String(a.igreen_consultor_id)] = a.id;
    }

    for (const row of (data as Array<{
      status: string | null;
      igreen_account_id: string | null;
      registered_by_igreen_id: string | number | null;
    }> | null) || []) {
      let accountId = row.igreen_account_id && byId[row.igreen_account_id] ? row.igreen_account_id : null;
      if (!accountId && row.registered_by_igreen_id != null) {
        accountId = byConsultor[String(row.registered_by_igreen_id)] || null;
      }
      if (!accountId || !byId[accountId]) continue;
      bumpStatus(byId[accountId], row.status);
    }
    setAccountStats(byId);
  };

  const reloadAccounts = async () => {
    const { data } = await supabase
      .from("igreen_portal_accounts")
      .select("id, position, label, portal_email, igreen_consultor_id, credential_status, credential_checked_at, last_sync_at")
      .eq("consultant_id", userId)
      .order("position", { ascending: true });
    const list = (data as IGreenAccountRow[]) || [];
    setAccounts(list);
    await loadAccountStats(list);
    return list;
  };

  /** Após sync em background, atualiza totais a cada poucos segundos. */
  const scheduleStatsRefresh = () => {
    const delays = [8_000, 20_000, 45_000, 90_000];
    for (const ms of delays) {
      window.setTimeout(() => {
        void reloadAccounts();
      }, ms);
    }
  };

  useEffect(() => {
    if (!userId) return;
    (async () => {
      setLoading(true);
      await reloadAccounts();
      const { data: s } = await supabase
        .from("settings").select("value").eq("key", "last_igreen_sync").maybeSingle();
      if (s?.value) setLastSync(s.value as string);
      setLoading(false);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  const nextPosition = accounts.length > 0 ? Math.max(...accounts.map((a) => a.position)) + 1 : 1;

  const loadAccountCreds = async (accountId: string) => {
    const { data } = await supabase
      .from("igreen_portal_accounts")
      .select("portal_email, portal_password")
      .eq("id", accountId)
      .maybeSingle();
    return data as { portal_email: string; portal_password: string } | null;
  };

  const markAccountCredential = async (
    accountId: string,
    status: "valid" | "invalid_credentials" | "waf_blocked" | "failed",
  ) => {
    const checkedAt = new Date().toISOString();
    await supabase
      .from("igreen_portal_accounts")
      .update({ credential_status: status, credential_checked_at: checkedAt })
      .eq("id", accountId);
    setAccounts((prev) =>
      prev.map((a) =>
        a.id === accountId
          ? { ...a, credential_status: status, credential_checked_at: checkedAt }
          : a,
      ),
    );
  };

  const validateAccount = async (
    accountId: string,
    email: string,
    opts?: { quiet?: boolean },
  ): Promise<boolean> => {
    setValidatingId(accountId);
    try {
      const creds = await loadAccountCreds(accountId);
      if (!creds?.portal_email || !creds?.portal_password) {
        await markAccountCredential(accountId, "failed");
        if (!opts?.quiet) {
          toast({ title: "Faltam credenciais", description: "Salve e-mail e senha desta conta.", variant: "destructive" });
        }
        return false;
      }
      const res = await runIgreenSync(userId, "validate", {
        accountId,
        portalEmail: creds.portal_email,
        portalPassword: creds.portal_password,
      });
      if (res.ok === false) {
        const failure = res as { ok: false; reason: string; error: string };
        const status =
          failure.reason === "invalid_credentials" ? "invalid_credentials"
          : failure.reason === "waf_blocked" ? "waf_blocked"
          : "failed";
        await markAccountCredential(accountId, status);
        if (!opts?.quiet) {
          if (failure.reason === "invalid_credentials") {
            toast({ title: "E-mail ou senha errados", description: `Não entrou no portal com ${email}.`, variant: "destructive" });
          } else if (failure.reason === "waf_blocked") {
            toast({ title: "Portal bloqueado agora", description: "Cloudflare bloqueou o teste. Tente novamente em alguns minutos.", variant: "destructive" });
          } else {
            toast({ title: "Não consegui validar", description: failure.error, variant: "destructive" });
          }
        }
        return false;
      }
      await markAccountCredential(accountId, "valid");
      if (!opts?.quiet) {
        toast({ title: "Login OK", description: `Credenciais válidas para ${email}.` });
      }
      return true;
    } finally {
      setValidatingId(null);
      await reloadAccounts();
    }
  };

  const syncOneAccount = async (
    accountId: string,
    label: string,
    email: string,
    opts?: { skipValidate?: boolean; auto?: boolean },
  ) => {
    setSyncingAccountId(accountId);
    try {
      if (!opts?.skipValidate) {
        const loginOk = await validateAccount(accountId, email, { quiet: opts?.auto });
        if (!loginOk) return;
      }

      const res = await runIgreenSync(userId, "sync_all", { accountId });
      if (res.ok === false) {
        const status =
          res.reason === "invalid_credentials" ? "invalid_credentials"
          : res.reason === "waf_blocked" ? "waf_blocked"
          : "failed";
        await markAccountCredential(accountId, status);
        if (res.reason === "not_configured") {
          toast({ title: "Faltam credenciais", description: "Salve e-mail e senha desta conta primeiro.", variant: "destructive" });
        } else if (res.reason === "waf_blocked") {
          toast({ title: "Portal bloqueado no momento", description: "Tente de novo em alguns minutos.", variant: "destructive" });
        } else if (res.reason === "invalid_credentials") {
          toast({ title: "E-mail ou senha errados", description: `Não sincronizou ${label}.`, variant: "destructive" });
        } else if (res.reason === "already_running") {
          toast({ title: "Já tem sync em andamento", description: res.error, variant: "destructive" });
        } else {
          toast({ title: "Falha na sincronização", description: res.error, variant: "destructive" });
        }
        return;
      }
      setLastSync(new Date().toISOString());
      await reloadAccounts();
      scheduleStatsRefresh();
      toast({
        title: opts?.auto ? `${label}: sincronizando automaticamente` : `Sincronizando ${label}`,
        description: "Puxando cadastros desta conta. Os totais de aprovados/reprovados atualizam sozinhos.",
      });
    } catch (e) {
      toast({ title: "Erro", description: e instanceof Error ? e.message : "", variant: "destructive" });
    } finally {
      setSyncingAccountId(null);
    }
  };

  const addAccount = async () => {
    if (!newEmail.trim() || !newPassword.trim()) {
      toast({ title: "Preencha e-mail e senha", variant: "destructive" });
      return;
    }
    setSavingNew(true);
    try {
      const { data, error } = await supabase
        .from("igreen_portal_accounts")
        .insert({
          consultant_id: userId,
          position: nextPosition,
          label: newLabel.trim() || `Conta ${nextPosition}`,
          portal_email: newEmail.trim().toLowerCase(),
          portal_password: newPassword,
        })
        .select("id")
        .single();
      if (error) throw error;
      const label = newLabel.trim() || `Conta ${nextPosition}`;
      const email = newEmail.trim().toLowerCase();
      toast({ title: "Conta adicionada", description: "Testando login e sincronizando…" });
      await reloadAccounts();
      setAddingNew(false);
      setNewEmail(""); setNewPassword(""); setNewLabel("");
      if (data?.id) {
        const ok = await validateAccount(data.id, email, { quiet: true });
        if (ok) {
          await syncOneAccount(data.id, label, email, { skipValidate: true, auto: true });
        } else {
          toast({ title: "E-mail ou senha errados", description: email, variant: "destructive" });
        }
      }
    } catch (e) {
      toast({ title: "Erro ao adicionar conta", description: e instanceof Error ? e.message : "", variant: "destructive" });
    } finally {
      setSavingNew(false);
    }
  };

  const saveAccountEdits = async (accountId: string) => {
    const email = editEmail.trim().toLowerCase();
    const pwd = editPassword.trim();
    const label = editLabel.trim() || accounts.find((a) => a.id === accountId)?.label || "Conta";
    if (!email) {
      toast({ title: "Informe o e-mail", variant: "destructive" });
      return;
    }
    if (email.includes("@@")) {
      toast({
        title: "E-mail inválido",
        description: "Tem @@ no meio — corrija antes de salvar (ex.: usuario@hotmail.com).",
        variant: "destructive",
      });
      return;
    }
    setSavingAccountId(accountId);
    try {
      const patch: {
        portal_email: string;
        label: string | null;
        updated_at: string;
        portal_password?: string;
      } = {
        portal_email: email,
        label: editLabel.trim() || null,
        updated_at: new Date().toISOString(),
      };
      if (pwd) patch.portal_password = pwd;
      const { error } = await supabase
        .from("igreen_portal_accounts")
        .update(patch)
        .eq("id", accountId);
      if (error) throw error;
      cancelEdit();
      await reloadAccounts();
      toast({ title: "Conta atualizada", description: "Testando login e sincronizando automaticamente…" });
      const ok = await validateAccount(accountId, email, { quiet: true });
      if (ok) {
        await syncOneAccount(accountId, label, email, { skipValidate: true, auto: true });
      } else {
        toast({
          title: "E-mail ou senha errados",
          description: "Corriga e salve de novo — o sync só roda com login OK.",
          variant: "destructive",
        });
      }
    } catch (e) {
      toast({ title: "Erro ao salvar", description: e instanceof Error ? e.message : "", variant: "destructive" });
    } finally {
      setSavingAccountId(null);
    }
  };

  const removeAccount = async (accountId: string, position: number) => {
    if (position === 1) {
      toast({ title: "A conta principal não pode ser removida aqui", description: "Ela é a conta 1 (principal) do seu cadastro.", variant: "destructive" });
      return;
    }
    setRemovingId(accountId);
    try {
      const { error } = await supabase.from("igreen_portal_accounts").delete().eq("id", accountId);
      if (error) throw error;
      toast({ title: "Conta removida" });
      await reloadAccounts();
    } catch (e) {
      toast({ title: "Erro ao remover", description: e instanceof Error ? e.message : "", variant: "destructive" });
    } finally {
      setRemovingId(null);
    }
  };

  const sync = async () => {
    setSyncing(true);
    try {
      const res = await runIgreenSync(userId, "sync_all");
      if (res.ok === false) {
        if (res.reason === "not_configured") {
          toast({ title: "Faltam credenciais", description: "Salve o e-mail e a senha do escritório iGreen primeiro.", variant: "destructive" });
        } else if (res.reason === "waf_blocked") {
          toast({ title: "Portal bloqueado no momento", description: "O escritório iGreen está bloqueando o acesso automático agora. Tente de novo em alguns minutos.", variant: "destructive" });
        } else if (res.reason === "invalid_credentials") {
          toast({ title: "Login inválido", description: "Alguma das contas tem e-mail ou senha incorretos.", variant: "destructive" });
        } else {
          toast({ title: "Falha na sincronização", description: res.error, variant: "destructive" });
        }
        return;
      }
      setLastSync(new Date().toISOString());
      const d = res.data as Record<string, any>;
      if (d?.background) {
        await reloadAccounts();
        scheduleStatsRefresh();
        const contas = accounts.length > 1 ? ` (${accounts.length} contas)` : "";
        toast({
          title: "Sincronização iniciada",
          description: `Todas as contas${contas}: lista completa de clientes. Totais de aprovados/reprovados atualizam sozinhos.`,
        });
        return;
      }
      await queryClient.invalidateQueries();
      await reloadAccounts();
      toast({ title: "Sincronizado!" });
    } catch (e) {
      toast({ title: "Erro", description: e instanceof Error ? e.message : "", variant: "destructive" });
    } finally {
      setSyncing(false);
    }
  };

  const syncLabel = (() => {
    if (!lastSync) return "Nunca sincronizado";
    const dt = new Date(lastSync);
    if (Number.isNaN(dt.getTime())) return "";
    return `Última sincronização ${formatDistanceToNow(dt, { addSuffix: true, locale: ptBR })}`;
  })();

  const statusBadge = (
    status: string | null,
    checkedAt: string | null,
    opts?: { neverSynced?: boolean },
  ) => {
    if (status === "valid") {
      return (
        <span
          className="inline-flex items-center gap-1 rounded-full border border-emerald-500/40 bg-emerald-500/10 px-2 py-0.5 text-[11px] font-semibold text-emerald-700"
          title={checkedAt ? `Verificado ${formatDistanceToNow(new Date(checkedAt), { addSuffix: true, locale: ptBR })}` : undefined}
        >
          ✓ Login OK
        </span>
      );
    }
    if (status === "invalid_credentials") {
      return (
        <span
          className="inline-flex items-center gap-1 rounded-full border border-red-500/50 bg-red-500/15 px-2 py-0.5 text-[11px] font-semibold text-red-700"
          title={checkedAt ? `Verificado ${formatDistanceToNow(new Date(checkedAt), { addSuffix: true, locale: ptBR })}` : undefined}
        >
          ✕ E-mail ou senha errados
        </span>
      );
    }
    if (status === "waf_blocked") {
      return (
        <span className="inline-flex items-center gap-1 rounded-full border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 text-[11px] font-semibold text-amber-700">
          Bloqueado (WAF)
        </span>
      );
    }
    if (status === "failed") {
      return (
        <span className="inline-flex items-center gap-1 rounded-full border border-red-500/40 bg-red-500/10 px-2 py-0.5 text-[11px] font-semibold text-red-700">
          Falha no login
        </span>
      );
    }
    if (opts?.neverSynced) {
      return (
        <span className="inline-flex items-center gap-1 rounded-full border border-muted-foreground/30 bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
          Ainda não testada
        </span>
      );
    }
    return null;
  };

  return (
    <div className="rounded-lg border bg-card p-4 space-y-4">
      <div>
        <h3 className="font-semibold flex items-center gap-2">
          <KeyRound className="h-4 w-4" /> Conexão com o Escritório iGreen
        </h3>
        <p className="text-xs text-muted-foreground mt-1">
          Informe o login do portal <code>escritorio.igreenenergy.com.br</code>. Com ele,
          sincronizamos automaticamente seus <b>clientes</b>, <b>rede</b>, <b>boletos</b> e
          <b> métricas</b>. Você pode ter mais de uma conta iGreen — a conta 1 é a
          principal, e o sync passa por todas em ordem automaticamente.
        </p>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Carregando…</div>
      ) : (
        <>
          <div className="space-y-3">
            {accounts.map((acc) => {
              const isEditing = editingId === acc.id;
              const loginBad = acc.credential_status === "invalid_credentials" || acc.credential_status === "failed";
              return (
              <div
                key={acc.id}
                className={
                  "rounded-md border p-3 space-y-2 " +
                  (loginBad ? "border-red-500/60 bg-red-500/5" : "bg-muted/30")
                }
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-2 text-sm font-medium">
                    <span className="inline-flex items-center justify-center h-5 w-5 rounded-full bg-primary/15 text-primary text-[11px] font-bold">
                      {acc.position}
                    </span>
                    {acc.label || `Conta ${acc.position}`}
                    {acc.position === 1 && <span className="text-[10px] text-muted-foreground">(principal)</span>}
                    {statusBadge(acc.credential_status, acc.credential_checked_at, {
                      neverSynced: !acc.igreen_consultor_id && !acc.last_sync_at,
                    })}
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    {!isEditing && (
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className="h-7 gap-1 text-xs"
                        onClick={() => startEdit(acc)}
                      >
                        <Pencil className="h-3 w-3" />
                        Editar
                      </Button>
                    )}
                  </div>
                </div>

                {loginBad && (
                  <div className="rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-800 font-medium">
                    E-mail ou senha errados nesta conta. Clique em Editar, corrija e Salvar — o teste de login roda na hora.
                  </div>
                )}

                {isEditing ? (
                  <div className="space-y-2">
                    <div className="grid gap-2 sm:grid-cols-3">
                      <div className="space-y-1">
                        <Label className="text-[11px]">Nome (parceiro)</Label>
                        <Input
                          value={editLabel}
                          onChange={(e) => setEditLabel(e.target.value)}
                          placeholder={`Conta ${acc.position}`}
                          className="h-8 text-sm"
                          autoFocus
                        />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-[11px]">E-mail</Label>
                        <Input
                          type="email"
                          value={editEmail}
                          onChange={(e) => setEditEmail(e.target.value)}
                          className="h-8 text-sm"
                        />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-[11px]">Nova senha</Label>
                        <div className="relative">
                          <Input
                            type={showEditPassword ? "text" : "password"}
                            placeholder="Digite a senha correta"
                            value={editPassword}
                            onChange={(e) => setEditPassword(e.target.value)}
                            className="h-8 text-sm pr-8"
                            autoComplete="new-password"
                          />
                          <button
                            type="button"
                            onClick={() => setShowEditPassword((v) => !v)}
                            className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground"
                            tabIndex={-1}
                          >
                            {showEditPassword ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                          </button>
                        </div>
                      </div>
                    </div>
                    <p className="text-[11px] text-muted-foreground">
                      Corrija e-mail (ex.: @@ errado) e/ou digite a senha do portal. Senha em branco = mantém a atual.
                    </p>
                    <div className="flex flex-wrap gap-1">
                      <Button
                        size="sm"
                        className="h-8"
                        disabled={savingAccountId === acc.id}
                        onClick={() => saveAccountEdits(acc.id)}
                      >
                        {savingAccountId === acc.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Salvar"}
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-8"
                        disabled={savingAccountId === acc.id}
                        onClick={cancelEdit}
                      >
                        <X className="h-3.5 w-3.5 mr-1" />
                        Cancelar
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-8"
                        disabled={validatingId === acc.id}
                        onClick={() => validateAccount(acc.id, editEmail.trim() || acc.portal_email)}
                        title="Testar login desta conta"
                      >
                        {validatingId === acc.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                      </Button>
                      {acc.position !== 1 && (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-8 text-destructive ml-auto"
                          disabled={removingId === acc.id}
                          onClick={() => removeAccount(acc.id, acc.position)}
                          title="Remover esta conta"
                        >
                          {removingId === acc.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                        </Button>
                      )}
                    </div>
                  </div>
                ) : (
                  <div className="space-y-1">
                    <div className="text-sm break-all">{acc.portal_email}</div>
                    <div className="flex flex-wrap gap-1">
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-8"
                        disabled={syncingAccountId === acc.id || syncing}
                        onClick={() => syncOneAccount(acc.id, acc.label || `Conta ${acc.position}`, acc.portal_email)}
                        title="Sincronizar só esta conta"
                      >
                        {syncingAccountId === acc.id
                          ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />
                          : <RefreshCw className="h-3.5 w-3.5 mr-1" />}
                        <span className="text-xs">Sincronizar</span>
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-8"
                        disabled={validatingId === acc.id}
                        onClick={() => validateAccount(acc.id, acc.portal_email)}
                        title="Testar login desta conta"
                      >
                        {validatingId === acc.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                        <span className="ml-1 text-xs">Testar login</span>
                      </Button>
                      {acc.position !== 1 && (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-8 text-destructive"
                          disabled={removingId === acc.id}
                          onClick={() => removeAccount(acc.id, acc.position)}
                          title="Remover esta conta"
                        >
                          {removingId === acc.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                        </Button>
                      )}
                    </div>
                  </div>
                )}

                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px]">
                  {(() => {
                    const st = accountStats[acc.id] || emptyStats();
                    return (
                      <>
                        <span className="font-medium text-foreground">
                          {st.total} cadastro{st.total === 1 ? "" : "s"}
                        </span>
                        <span className="text-emerald-700 font-medium">
                          {st.aprovados} aprovado{st.aprovados === 1 ? "" : "s"}
                        </span>
                        <span className="text-red-700 font-medium">
                          {st.reprovados} reprovado{st.reprovados === 1 ? "" : "s"}
                        </span>
                        {st.outros > 0 && (
                          <span className="text-muted-foreground">
                            {st.outros} outros
                          </span>
                        )}
                      </>
                    );
                  })()}
                </div>
                <div className="text-[11px] text-muted-foreground">
                  {acc.igreen_consultor_id ? `ID iGreen ${acc.igreen_consultor_id}` : "Ainda não sincronizada"}
                  {acc.last_sync_at ? ` • última sync ${formatDistanceToNow(new Date(acc.last_sync_at), { addSuffix: true, locale: ptBR })}` : ""}
                  {syncingAccountId === acc.id ? " • sincronizando agora…" : ""}
                </div>
              </div>
              );
            })}

            {accounts.length === 0 && (
              <p className="text-sm text-muted-foreground">Nenhuma conta iGreen configurada ainda.</p>
            )}
          </div>

          {addingNew ? (
            <div className="rounded-md border border-dashed p-3 space-y-2">
              <p className="text-xs font-medium">Nova conta (posição {nextPosition})</p>
              <div className="grid gap-2 sm:grid-cols-3">
                <div className="space-y-1">
                  <Label className="text-[11px]">Nome (opcional)</Label>
                  <Input placeholder={`Conta ${nextPosition}`} value={newLabel} onChange={(e) => setNewLabel(e.target.value)} className="h-8 text-sm" />
                </div>
                <div className="space-y-1">
                  <Label className="text-[11px]">E-mail do iGreen</Label>
                  <Input type="email" placeholder="seu@email.com" value={newEmail} onChange={(e) => setNewEmail(e.target.value)} className="h-8 text-sm" />
                </div>
                <div className="space-y-1">
                  <Label className="text-[11px]">Senha</Label>
                  <div className="relative">
                    <Input
                      type={showNewPassword ? "text" : "password"}
                      placeholder="sua senha"
                      value={newPassword}
                      onChange={(e) => setNewPassword(e.target.value)}
                      className="h-8 text-sm"
                    />
                    <button type="button" onClick={() => setShowNewPassword((v) => !v)} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground" tabIndex={-1}>
                      {showNewPassword ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                    </button>
                  </div>
                </div>
              </div>
              <div className="flex gap-2">
                <Button size="sm" onClick={addAccount} disabled={savingNew}>
                  {savingNew ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <CheckCircle2 className="h-4 w-4 mr-2" />}
                  Salvar conta
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setAddingNew(false)} disabled={savingNew}>Cancelar</Button>
              </div>
            </div>
          ) : (
            <Button size="sm" variant="outline" onClick={() => setAddingNew(true)}>
              <Plus className="h-4 w-4 mr-2" /> Adicionar mais uma conta
            </Button>
          )}

          <div className="flex flex-wrap items-center gap-2 pt-2 border-t">
            <Button onClick={sync} disabled={syncing || accounts.length === 0} size="sm">
              {syncing ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <RefreshCw className="h-4 w-4 mr-2" />}
              Sincronizar {accounts.length > 1 ? `todas as ${accounts.length} contas` : "agora"}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => {
                try {
                  sessionStorage.removeItem(`customers_cache_${userId}`);
                  localStorage.removeItem("sync_cooldown_until");
                } catch { /* ignore */ }
                void queryClient.invalidateQueries();
                toast({ title: "Cache limpo", description: "A lista de clientes vai recarregar." });
              }}
              title="Limpar cache local e recarregar a lista de clientes"
            >
              Recarregar clientes
            </Button>
            <span className="text-xs text-muted-foreground ml-auto">{syncLabel}</span>
          </div>

          <p className="text-[11px] text-muted-foreground border-l-2 border-primary/40 pl-3">
            Suas senhas são guardadas de forma protegida e usadas apenas para a sincronização
            automática dos seus dados. A primeira sincronização pode levar até 1 minuto por conta.
          </p>
        </>
      )}
    </div>
  );
}
