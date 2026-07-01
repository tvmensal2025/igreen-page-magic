import { useEffect, useState } from "react";
import { KeyRound, Loader2, RefreshCw, CheckCircle2, Eye, EyeOff } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { runIgreenSync } from "@/lib/igreenSync";
import { formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";

/**
 * Card de conexão com o Escritório iGreen. O consultor salva e-mail + senha do
 * portal (escritorio.igreenenergy.com.br); a partir daí a sincronização puxa
 * TODOS os dados dele (clientes, rede, boletos, métricas) via worker green.
 * Substitui o antigo IGreenExtensionCard (extensão Chrome, descontinuada).
 */
export function IGreenConnectionCard({ userId }: { userId: string }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [hasSavedPassword, setHasSavedPassword] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [lastSync, setLastSync] = useState<string | null>(null);
  const [consultorId, setConsultorId] = useState<string | null>(null);

  useEffect(() => {
    if (!userId) return;
    (async () => {
      setLoading(true);
      // Não lemos a senha (coluna com REVOKE SELECT p/ authenticated). Só sabemos
      // se existe via a flag igreen_consultor_id / presença anterior de sync.
      const { data } = await supabase
        .from("consultants")
        .select("igreen_portal_email, igreen_consultor_id")
        .eq("id", userId)
        .maybeSingle();
      if (data) {
        setEmail((data.igreen_portal_email as string) || "");
        setConsultorId((data.igreen_consultor_id as string) || null);
        setHasSavedPassword(!!data.igreen_portal_email);
      }
      const { data: s } = await supabase
        .from("settings").select("value").eq("key", "last_igreen_sync").maybeSingle();
      if (s?.value) setLastSync(s.value as string);
      setLoading(false);
    })();
  }, [userId]);

  const save = async () => {
    if (!email.trim()) {
      toast({ title: "Informe o e-mail", description: "E-mail do escritório iGreen é obrigatório.", variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      const patch: Record<string, unknown> = { igreen_portal_email: email.trim().toLowerCase() };
      // Só grava a senha se o usuário digitou uma nova (campo vem vazio por segurança).
      if (password.trim()) patch.igreen_portal_password = password;
      const { error } = await supabase.from("consultants").update(patch as never).eq("id", userId);
      if (error) throw error;
      if (password.trim()) setHasSavedPassword(true);
      setPassword("");
      toast({ title: "Conexão salva", description: "Credenciais do escritório iGreen atualizadas." });
    } catch (e) {
      toast({ title: "Erro ao salvar", description: e instanceof Error ? e.message : "", variant: "destructive" });
    } finally {
      setSaving(false);
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
          toast({ title: "Login inválido", description: "E-mail ou senha do escritório iGreen incorretos.", variant: "destructive" });
        } else {
          toast({ title: "Falha na sincronização", description: res.error, variant: "destructive" });
        }
        return;
      }
      setLastSync(new Date().toISOString());
      const d = res.data as Record<string, any>;
      if (d?.consultor_id) setConsultorId(String(d.consultor_id));
      const cust = d?.customers?.updated ?? d?.updated ?? 0;
      const net = d?.network?.updated ?? 0;
      // Atualiza os dados exibidos nas outras telas (clientes, rede, dashboard)
      // sem precisar recarregar a página.
      await queryClient.invalidateQueries();
      toast({ title: "✅ Sincronizado!", description: `Clientes: ${cust} • Rede: ${net} atualizados a partir do iGreen.` });
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

  return (
    <div className="rounded-lg border bg-card p-4 space-y-4">
      <div>
        <h3 className="font-semibold flex items-center gap-2">
          <KeyRound className="h-4 w-4" /> Conexão com o Escritório iGreen
        </h3>
        <p className="text-xs text-muted-foreground mt-1">
          Informe o login do portal <code>escritorio.igreenenergy.com.br</code>. Com ele,
          sincronizamos automaticamente seus <b>clientes</b>, <b>rede</b>, <b>boletos</b> e
          <b> métricas</b> — sem extensão e sem precisar abrir o portal.
        </p>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Carregando…</div>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor="igreen-email">E-mail do iGreen</Label>
              <Input
                id="igreen-email"
                type="email"
                autoComplete="off"
                placeholder="seu@email.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="igreen-pass">Senha do iGreen</Label>
              <div className="relative">
                <Input
                  id="igreen-pass"
                  type={showPassword ? "text" : "password"}
                  autoComplete="new-password"
                  placeholder={hasSavedPassword ? "•••••••• (salva)" : "sua senha"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground"
                  tabIndex={-1}
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button onClick={save} disabled={saving} size="sm" variant="outline">
              {saving ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <CheckCircle2 className="h-4 w-4 mr-2" />}
              Salvar credenciais
            </Button>
            <Button onClick={sync} disabled={syncing || !hasSavedPassword} size="sm">
              {syncing ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <RefreshCw className="h-4 w-4 mr-2" />}
              Sincronizar agora
            </Button>
            <span className="text-xs text-muted-foreground ml-auto">
              {syncLabel}{consultorId ? ` • ID iGreen ${consultorId}` : ""}
            </span>
          </div>

          <p className="text-[11px] text-muted-foreground border-l-2 border-primary/40 pl-3">
            Sua senha é guardada de forma protegida e usada apenas para a sincronização
            automática dos seus dados. A primeira sincronização pode levar até 1 minuto.
          </p>
        </>
      )}
    </div>
  );
}
