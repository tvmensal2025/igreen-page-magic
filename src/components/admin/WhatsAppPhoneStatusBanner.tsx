import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { AlertTriangle, CheckCircle2, RefreshCw, Phone } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatBrazilPhone, phonesMatch } from "@/lib/phone";
import { useToast } from "@/hooks/use-toast";

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
    let status: Status;
    if (!consultantPhone) status = "no_phone";
    else if (!connectedPhone) status = "no_instance";
    else if (phonesMatch(consultantPhone, connectedPhone)) status = "ok";
    else status = "mismatch";
    setState({ status, consultantPhone, connectedPhone, verifiedAt });
  };

  useEffect(() => { void load(); }, [consultantId]);

  const handleRevalidate = async () => {
    if (!consultantId) return;
    setRevalidating(true);
    try {
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

  const variants = {
    no_phone: {
      title: "Telefone WhatsApp não cadastrado",
      body: "Cadastre seu WhatsApp no painel para liberar os envios automáticos.",
    },
    no_instance: {
      title: "Nenhuma instância WhatsApp conectada",
      body: "Conecte sua instância em Configurações > WhatsApp. Enquanto isso, disparos automáticos ficam pausados para proteger sua conta.",
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
