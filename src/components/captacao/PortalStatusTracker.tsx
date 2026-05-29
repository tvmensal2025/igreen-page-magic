import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Loader2, CheckCircle2, AlertTriangle, KeyRound, ScanFace, Send, Copy, RefreshCw, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast as sonnerToast } from "sonner";

interface Props {
  customerId: string;
  consultantId: string;
  onRetry?: () => void;
}

interface Row {
  status: string | null;
  conversation_step: string | null;
  otp_code: string | null;
  link_assinatura: string | null;
  igreen_code: string | null;
  error_message: string | null;
  finalized_at: string | null;
}

interface PortalTrace {
  status: string | null;
  error: string | null;
  created_at: string;
}

const ACTIVE_STEPS = new Set([
  "portal_submitting", "aguardando_otp", "awaiting_otp",
  "validando_otp", "validating_otp",
  "aguardando_assinatura", "awaiting_signature",
  "cadastro_concluido", "registered_igreen",
  "worker_offline", "automation_failed",
]);

// Tradução amigável para erros conhecidos do portal iGreen
function friendlyPortalError(raw: string): string {
  const m = raw.toLowerCase();
  if (m.includes("duplicatephone") || (m.includes("celular") && m.includes("já existe"))) {
    return "❌ Portal rejeitou: este celular já está cadastrado no iGreen. Cancele o cadastro anterior no portal ou troque o telefone do lead e reenvie.";
  }
  if (m.includes("duplicatedocument") || m.includes("cpf") && m.includes("já existe")) {
    return "❌ Portal rejeitou: este CPF já está cadastrado no iGreen.";
  }
  if (m.includes("duplicateemail") || (m.includes("email") && m.includes("já existe"))) {
    return "❌ Portal rejeitou: este e-mail já está cadastrado no iGreen.";
  }
  if (m.includes("nenhuma cobertura ativa")) {
    return "❌ Portal rejeitou: não há cobertura ativa para essa concessionária/UF.";
  }
  return raw;
}

export function PortalStatusTracker({ customerId, consultantId, onRetry }: Props) {
  const [row, setRow] = useState<Row | null>(null);
  const [trace, setTrace] = useState<PortalTrace | null>(null);
  const [retrying, setRetrying] = useState(false);

  useEffect(() => {
    if (!customerId) return;
    let cancelled = false;
    const reload = async () => {
      const [{ data: cust }, { data: traces }] = await Promise.all([
        supabase
          .from("customers")
          .select("status, conversation_step, otp_code, link_assinatura, igreen_code, error_message, finalized_at")
          .eq("id", customerId).maybeSingle(),
        supabase
          .from("portal2_audit_traces")
          .select("status, error, created_at")
          .eq("customer_id", customerId)
          .order("created_at", { ascending: false })
          .limit(1),
      ]);
      if (cancelled) return;
      setRow((cust as Row) || null);
      setTrace(((traces as PortalTrace[])?.[0]) || null);
    };
    void reload();
    const ch = supabase
      .channel(`portal-${customerId}-${Math.random().toString(36).slice(2, 8)}`)
      .on("postgres_changes",
        { event: "UPDATE", schema: "public", table: "customers", filter: `id=eq.${customerId}` },
        (payload) => setRow((prev) => ({ ...(prev || {} as Row), ...(payload.new as any) })),
      )
      .on("postgres_changes",
        { event: "INSERT", schema: "public", table: "portal2_audit_traces", filter: `customer_id=eq.${customerId}` },
        (payload) => setTrace(payload.new as PortalTrace),
      )
      .subscribe();
    return () => { cancelled = true; void supabase.removeChannel(ch); };
  }, [customerId]);

  const step = String(row?.conversation_step || row?.status || "").toLowerCase();
  const hasPortalError =
    (trace?.status === "failed" && !!trace?.error) ||
    step === "worker_offline" ||
    step === "automation_failed" ||
    (!!row?.error_message && step !== "cadastro_concluido" && step !== "registered_igreen");

  const visible = !!row?.finalized_at || ACTIVE_STEPS.has(step) || hasPortalError;
  if (!visible) return null;

  const isOffline = step === "worker_offline" || step === "automation_failed";
  const isDone = step === "cadastro_concluido" || step === "registered_igreen";
  const isOtp = step === "aguardando_otp" || step === "awaiting_otp";
  const isSign = step === "aguardando_assinatura" || step === "awaiting_signature";
  const isValidating = step === "validando_otp" || step === "validating_otp";

  // Banner de erro do portal tem prioridade máxima (cobre duplicate phone/cpf, etc.)
  const showError = hasPortalError && !isDone;

  let icon = <Loader2 className="w-4 h-4 animate-spin text-yellow-400" />;
  let title = "Abrindo portal no navegador da VPS…";
  let tone = "border-yellow-500/40 bg-yellow-500/10 text-yellow-100";
  if (showError) { icon = <XCircle className="w-4 h-4 text-red-300" />; title = "Cadastro recusado pelo portal iGreen"; tone = "border-red-500/50 bg-red-500/15 text-red-100"; }
  else if (isOtp) { icon = <KeyRound className="w-4 h-4 text-orange-300" />; title = "Código enviado ao WhatsApp do cliente — aguardando digitar"; tone = "border-orange-500/40 bg-orange-500/10 text-orange-100"; }
  else if (isValidating) { icon = <Loader2 className="w-4 h-4 animate-spin text-blue-300" />; title = "Validando código no portal…"; tone = "border-blue-500/40 bg-blue-500/10 text-blue-100"; }
  else if (isSign) { icon = <ScanFace className="w-4 h-4 text-purple-300" />; title = "Link de selfie enviado ao cliente"; tone = "border-purple-500/40 bg-purple-500/10 text-purple-100"; }
  else if (isDone) { icon = <CheckCircle2 className="w-4 h-4 text-emerald-300" />; title = "Cadastro concluído ✅"; tone = "border-emerald-500/40 bg-emerald-500/10 text-emerald-100"; }
  else if (isOffline) { icon = <AlertTriangle className="w-4 h-4 text-red-300" />; title = "Portal momentaneamente offline"; tone = "border-red-500/40 bg-red-500/10 text-red-100"; }

  const retry = async () => {
    if (retrying) return;
    setRetrying(true);
    try {
      const { data, error } = await supabase.functions.invoke("finalize-capture", { body: { customerId, consultantId } });
      if (error || (data as any)?.error) throw new Error((data as any)?.error || error?.message);
      sonnerToast.success("Reenviado ao portal");
      onRetry?.();
    } catch (e: any) {
      sonnerToast.error(e?.message || "Falha ao reenviar");
    } finally { setRetrying(false); }
  };

  const copy = async (txt: string, label: string) => {
    try { await navigator.clipboard.writeText(txt); sonnerToast.success(`${label} copiado`); } catch {}
  };

  // Texto detalhado do erro: prefere trace.error, fallback para row.error_message
  const rawError = (trace?.status === "failed" ? trace?.error : null) || row?.error_message || "";
  const errorText = rawError ? friendlyPortalError(rawError) : "";

  return (
    <div className={`mx-3 mt-2 rounded-md border px-3 py-2 text-[11px] ${tone}`}>
      <div className="flex items-center gap-2">
        {icon}
        <span className="font-bold flex-1 truncate">{title}</span>
        {(isOffline || showError) && (
          <Button size="sm" variant="outline" className="h-6 px-2 text-[10px]" disabled={retrying} onClick={retry}>
            {retrying ? <Loader2 className="w-3 h-3 animate-spin" /> : <><RefreshCw className="w-3 h-3 mr-1" />Reenviar ao portal</>}
          </Button>
        )}
      </div>
      {isOtp && row?.otp_code && (
        <div className="mt-1.5 flex items-center gap-1.5">
          <span className="opacity-80">Código recebido:</span>
          <code className="font-mono text-sm font-bold">{row.otp_code}</code>
          <Button size="icon" variant="ghost" className="h-5 w-5" onClick={() => copy(row.otp_code!, "Código")}><Copy className="w-3 h-3" /></Button>
        </div>
      )}
      {isSign && row?.link_assinatura && (
        <div className="mt-1.5 flex items-center gap-1.5">
          <Send className="w-3 h-3" />
          <a href={row.link_assinatura} target="_blank" rel="noreferrer" className="underline truncate">{row.link_assinatura}</a>
          <Button size="icon" variant="ghost" className="h-5 w-5" onClick={() => copy(row.link_assinatura!, "Link")}><Copy className="w-3 h-3" /></Button>
        </div>
      )}
      {isDone && row?.igreen_code && (
        <div className="mt-1.5">Código iGreen: <code className="font-mono font-bold">{row.igreen_code}</code></div>
      )}
      {showError && errorText && (
        <p className="mt-1.5 leading-snug whitespace-pre-wrap">{errorText}</p>
      )}
      {!showError && isOffline && row?.error_message && (
        <p className="mt-1 opacity-80">{row.error_message}</p>
      )}
    </div>
  );
}
