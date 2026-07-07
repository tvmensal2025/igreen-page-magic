import { useEffect, useState } from "react";
import { KeyRound, Loader2, RefreshCw, CheckCircle2, Eye, EyeOff, Plus, Trash2 } from "lucide-react";
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

  // form de "adicionar conta" (aparece ao clicar no botão)
  const [addingNew, setAddingNew] = useState(false);
  const [newEmail, setNewEmail] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newLabel, setNewLabel] = useState("");
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [savingNew, setSavingNew] = useState(false);

  // edição inline de senha por conta (mapa accountId -> senha digitada)
  const [editPasswords, setEditPasswords] = useState<Record<string, string>>({});
  const [showEditPassword, setShowEditPassword] = useState<Record<string, boolean>>({});
  const [savingAccountId, setSavingAccountId] = useState<string | null>(null);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [validatingId, setValidatingId] = useState<string | null>(null);

  const reloadAccounts = async () => {
    const { data } = await supabase
      .from("igreen_portal_accounts")
      .select("id, position, label, portal_email, igreen_consultor_id, credential_status, credential_checked_at, last_sync_at")
      .eq("consultant_id", userId)
      .order("position", { ascending: true });
    setAccounts((data as IGreenAccountRow[]) || []);
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

  const validateAccount = async (accountId: string, email: string) => {
    setValidatingId(accountId);
    try {
      const res = await runIgreenSync(userId, "validate");
      await reloadAccounts();
      if (res.ok === false) {
        const failure = res as { ok: false; reason: string; error: string };
        if (failure.reason === "invalid_credentials") {
          toast({ title: "Login inválido", description: `E-mail ou senha incorretos para ${email}.`, variant: "destructive" });
        } else if (failure.reason === "waf_blocked") {
          toast({ title: "Portal bloqueado agora", description: "Cloudflare bloqueou o teste. Tente novamente em alguns minutos.", variant: "destructive" });
        } else {
          toast({ title: "Não consegui validar", description: failure.error, variant: "destructive" });
        }
      } else {
        toast({ title: "✅ Credenciais válidas", description: `Login confirmado para ${email}.` });
      }
    } finally {
      setValidatingId(null);
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
      toast({ title: "Conta adicionada", description: "Validando credenciais…" });
      await reloadAccounts();
      setAddingNew(false);
      setNewEmail(""); setNewPassword(""); setNewLabel("");
      if (data?.id) await validateAccount(data.id, newEmail.trim());
    } catch (e) {
      toast({ title: "Erro ao adicionar conta", description: e instanceof Error ? e.message : "", variant: "destructive" });
    } finally {
      setSavingNew(false);
    }
  };

  const savePasswordForAccount = async (accountId: string, email: string) => {
    const pwd = editPasswords[accountId];
    if (!pwd || !pwd.trim()) return;
    setSavingAccountId(accountId);
    try {
      const { error } = await supabase
        .from("igreen_portal_accounts")
        .update({ portal_password: pwd, updated_at: new Date().toISOString() })
        .eq("id", accountId);
      if (error) throw error;
      setEditPasswords((p) => ({ ...p, [accountId]: "" }));
      toast({ title: "Senha atualizada" });
      await validateAccount(accountId, email);
    } catch (e) {
      toast({ title: "Erro ao salvar senha", description: e instanceof Error ? e.message : "", variant: "destructive" });
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
        const contas = accounts.length > 1 ? ` (${accounts.length} contas)` : "";
        toast({
          title: "Sincronização iniciada",
          description: `O iGreen vai atualizar clientes, boletos, devolutivas, telecom, seguros, rede, métricas e cashback em segundo plano${contas}. Pode levar alguns minutos.`,
        });
        return;
      }
      await queryClient.invalidateQueries();
      toast({ title: "✅ Sincronizado!" });
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

  const statusBadge = (status: string | null, checkedAt: string | null) => {
    if (!status) return null;
    return (
      <span
        className={
          "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium " +
          (status === "valid"
            ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-700"
            : status === "waf_blocked"
            ? "border-amber-500/40 bg-amber-500/10 text-amber-700"
            : "border-red-500/40 bg-red-500/10 text-red-700")
        }
        title={checkedAt ? `Verificado ${formatDistanceToNow(new Date(checkedAt), { addSuffix: true, locale: ptBR })}` : undefined}
      >
        {status === "valid" ? "✓ Login OK" : status === "invalid_credentials" ? "Login inválido" : status === "waf_blocked" ? "Bloqueado (WAF)" : "Falha"}
      </span>
    );
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
            {accounts.map((acc) => (
              <div key={acc.id} className="rounded-md border bg-muted/30 p-3 space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 text-sm font-medium">
                    <span className="inline-flex items-center justify-center h-5 w-5 rounded-full bg-primary/15 text-primary text-[11px] font-bold">
                      {acc.position}
                    </span>
                    {acc.label || `Conta ${acc.position}`}
                    {acc.position === 1 && <span className="text-[10px] text-muted-foreground">(principal)</span>}
                  </div>
                  {statusBadge(acc.credential_status, acc.credential_checked_at)}
                </div>
                <div className="grid gap-2 sm:grid-cols-[1fr_1fr_auto] items-end">
                  <div className="space-y-1">
                    <Label className="text-[11px]">E-mail</Label>
                    <Input value={acc.portal_email} disabled className="h-8 text-sm" />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-[11px]">Nova senha (opcional)</Label>
                    <div className="relative">
                      <Input
                        type={showEditPassword[acc.id] ? "text" : "password"}
                        placeholder="•••••••• (salva)"
                        value={editPasswords[acc.id] || ""}
                        onChange={(e) => setEditPasswords((p) => ({ ...p, [acc.id]: e.target.value }))}
                        className="h-8 text-sm"
                      />
                      <button
                        type="button"
                        onClick={() => setShowEditPassword((p) => ({ ...p, [acc.id]: !p[acc.id] }))}
                        className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground"
                        tabIndex={-1}
                      >
                        {showEditPassword[acc.id] ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                      </button>
                    </div>
                  </div>
                  <div className="flex gap-1">
                    <Button
                      size="sm" variant="outline" className="h-8"
                      disabled={savingAccountId === acc.id || !editPasswords[acc.id]?.trim()}
                      onClick={() => savePasswordForAccount(acc.id, acc.portal_email)}
                    >
                      {savingAccountId === acc.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Salvar"}
                    </Button>
                    <Button
                      size="sm" variant="ghost" className="h-8"
                      disabled={validatingId === acc.id}
                      onClick={() => validateAccount(acc.id, acc.portal_email)}
                      title="Testar login desta conta"
                    >
                      {validatingId === acc.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                    </Button>
                    {acc.position !== 1 && (
                      <Button
                        size="sm" variant="ghost" className="h-8 text-destructive"
                        disabled={removingId === acc.id}
                        onClick={() => removeAccount(acc.id, acc.position)}
                        title="Remover esta conta"
                      >
                        {removingId === acc.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                      </Button>
                    )}
                  </div>
                </div>
                <div className="text-[11px] text-muted-foreground">
                  {acc.igreen_consultor_id ? `ID iGreen ${acc.igreen_consultor_id}` : "Ainda não sincronizada"}
                  {acc.last_sync_at ? ` • última sync ${formatDistanceToNow(new Date(acc.last_sync_at), { addSuffix: true, locale: ptBR })}` : ""}
                </div>
              </div>
            ))}

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
