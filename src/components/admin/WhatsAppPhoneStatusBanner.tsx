import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { AlertTriangle, CheckCircle2, RefreshCw, Phone } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatBrazilPhone, phonesMatch } from "@/lib/phone";
import { useToast } from "@/hooks/use-toast";
import { useUserRole } from "@/hooks/useUserRole";

interface Props {
  consultantId: string | null;
}

type Status = "loading" | "ok" | "mismatch" | "no_instance" | "no_phone";

interface State {
  status: Status;
  consultantPhone: string | null;
  connectedPhone: string | null;
  verifiedAt: string | null;
}

/**
 * Banner que aparece no Dashboard quando o telefone cadastrado do consultor
 * não bate com o número conectado na instância Evolution. Enquanto isso, os
 * envios proativos (disparo PRO, reaquecimento, cron) ficam bloqueados na
 * edge function pra não banir a conta.
 */
export function WhatsAppPhoneStatusBanner({ consultantId }: Props) {
  const [state, setState] = useState<State>({ status: "loading", consultantPhone: null, connectedPhone: null, verifiedAt: null });
  const [revalidating, setRevalidating] = useState(false);
  const { toast } = useToast();
  // Super admin usa Whapi (não Evolution). A verificação de telefone abaixo só
  // faz sentido no canal Evolution, então não exibimos o banner para Whapi —
  // senão ele fica pedindo para "conectar" uma instância Evolution que nunca
  // será usada, mesmo com o WhatsApp já conectado via Whapi.
  const { isSuperAdmin, loading: roleLoading } = useUserRole(consultantId);

  const load = async () => {
    if (!consultantId) return;
    const [{ data: cons }, { data: inst }] = await Promise.all([
      supabase.from("consultants").select("phone, phone_verified_at").eq("id", consultantId).maybeSingle(),
      supabase.from("whatsapp_instances")
        .select("connected_phone, updated_at")
        .eq("consultant_id", consultantId)
        .not("connected_phone", "is", null)
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);
    const consultantPhone = cons?.phone || null;
    const connectedPhone = inst?.connected_phone || null;
    const verifiedAt = cons?.phone_verified_at || null;

    // Espelha a regra da trava real de envio (proactive-send-guard.ts):
    // o telefone é considerado válido quando foi verificado há no máximo 7 dias,
    // mesmo que naquele instante a instância esteja sem connected_phone
    // (ex.: reconexão momentânea). Sem isso, a faixa "voltava" a aparecer para
    // consultores já conectados/verificados toda vez que o número conectado
    // sumia por um momento.
    const VERIFY_TTL_MS = 7 * 24 * 60 * 60 * 1000;
    const recentlyVerified =
      !!verifiedAt && Date.now() - new Date(verifiedAt).getTime() < VERIFY_TTL_MS;

    let status: Status;
    if (!consultantPhone) status = "no_phone";
    else if (phonesMatch(consultantPhone, connectedPhone)) status = "ok";
    else if (recentlyVerified) status = "ok";
    else if (!connectedPhone) status = "no_instance";
    else status = "mismatch";
    setState({ status, consultantPhone, connectedPhone, verifiedAt });
  };

  useEffect(() => {
    void load();
    const onSync = () => { void load(); };
    window.addEventListener("igreen-wa-phone-synced", onSync);
    // Após escanear o QR, o número chega assíncrono — recheca um pouco.
    const t1 = window.setTimeout(() => void load(), 2500);
    const t2 = window.setTimeout(() => void load(), 8000);
    return () => {
      window.removeEventListener("igreen-wa-phone-synced", onSync);
      window.clearTimeout(t1);
      window.clearTimeout(t2);
    };
  }, [consultantId]);

  const handleRevalidate = async () => {
    if (!consultantId) return;
    setRevalidating(true);
    try {
      // Se o Zap já conectou mas o cadastro está sem telefone, assume o número conectado.
      if (!state.consultantPhone && state.connectedPhone) {
        const digits = state.connectedPhone.replace(/\D/g, "");
        const { error: upErr } = await supabase
          .from("consultants")
          .update({ phone: digits, phone_verified_at: new Date().toISOString() })
          .eq("id", consultantId);
        if (upErr) throw upErr;
        toast({
          title: "✅ WhatsApp verificado",
          description: `Usamos o número conectado (${formatBrazilPhone(digits)}) no seu cadastro.`,
        });
        await load();
        return;
      }

      const { data, error } = await supabase.rpc("check_consultant_phone_match", { _consultant_id: consultantId });
      if (error) throw error;
      const row = Array.isArray(data) ? data[0] : data;
      if (row?.matched) {
        toast({ title: "✅ WhatsApp verificado", description: "Os envios automáticos estão liberados." });
      } else {
        toast({
          title: "Ainda não bate",
          description: `Cadastro: ${formatBrazilPhone(row?.consultant_phone)} • Conectado: ${formatBrazilPhone(row?.connected_phone) || "—"}`,
          variant: "destructive",
          duration: 8000,
        });
      }
      await load();
    } catch (e) {
      toast({ title: "Erro ao revalidar", description: (e as Error).message, variant: "destructive" });
    } finally {
      setRevalidating(false);
    }
  };

  // Não mostra banner em status OK ou loading
  if (state.status === "loading" || state.status === "ok") return null;

  // Não mostra para Whapi (super admin) — canal não usa instância Evolution.
  if (roleLoading || isSuperAdmin) return null;

  const variants = {
    no_phone: {
      title: state.connectedPhone
        ? "Falta gravar o WhatsApp no cadastro"
        : "Telefone WhatsApp não cadastrado",
      body: state.connectedPhone
        ? `Seu Zap já está conectado (${formatBrazilPhone(state.connectedPhone)}). Clique em Revalidar para liberar os envios automáticos.`
        : "Cadastre seu WhatsApp no painel para liberar os envios automáticos.",
    },
    no_instance: {
      title: "Nenhuma instância WhatsApp conectada",
      body: "Conecte sua instância em WhatsApp. Enquanto isso, disparos automáticos ficam pausados para proteger sua conta.",
    },
    mismatch: {
      title: "WhatsApp do cadastro diferente do conectado",
      body: `Cadastro: ${formatBrazilPhone(state.consultantPhone) || "—"} • Conectado: ${formatBrazilPhone(state.connectedPhone) || "—"}. Disparos automáticos estão pausados para não banir sua conta.`,
    },
  } as const;

  const v = variants[state.status];

  return (
    <div className="rounded-xl border border-yellow-500/40 bg-yellow-500/10 p-4 flex items-start gap-3">
      <AlertTriangle className="w-5 h-5 text-yellow-500 mt-0.5 shrink-0" />
      <div className="flex-1 min-w-0">
        <p className="font-semibold text-foreground flex items-center gap-2">
          <Phone className="w-4 h-4" /> {v.title}
        </p>
        <p className="text-sm text-muted-foreground mt-1">{v.body}</p>
        {state.verifiedAt && (
          <p className="text-xs text-muted-foreground/80 mt-1 flex items-center gap-1">
            <CheckCircle2 className="w-3 h-3" /> Última verificação: {new Date(state.verifiedAt).toLocaleString("pt-BR")}
          </p>
        )}
      </div>
      <Button size="sm" variant="outline" onClick={handleRevalidate} disabled={revalidating} className="gap-1.5 shrink-0">
        <RefreshCw className={`w-3.5 h-3.5 ${revalidating ? "animate-spin" : ""}`} />
        Revalidar
      </Button>
    </div>
  );
}
