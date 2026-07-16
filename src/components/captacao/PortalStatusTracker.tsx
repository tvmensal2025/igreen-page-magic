import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Loader2, CheckCircle2, AlertTriangle, KeyRound, ScanFace, Send, Copy, RefreshCw, XCircle, ChevronDown, ChevronUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast as sonnerToast } from "sonner";

interface Props {
  customerId: string;
  consultantId: string;
  onRetry?: () => void;
  /** Mobile: banner do portal inicia recolhido para liberar área de mensagens. */
  defaultCollapsed?: boolean;
}

// Resultado de extração persistido pelo worker (já sanitizado/mascarado — Req 4/12).
// Lemos apenas campos não-PII; NUNCA reconstruímos o dado em claro (Req 5.9, 12.3).
type OcrResult = {
  success?: boolean | null;
  mode?: string | null;
  error?: string | null;
  rejection_reason?: string | null;
  [k: string]: unknown;
} | null;

interface Row {
  status: string | null;
  conversation_step: string | null;
  otp_code: string | null;
  link_assinatura: string | null;
  link_facial: string | null;
  portal2_contract_link: string | null;
  igreen_link: string | null;
  igreen_code: string | null;
  error_message: string | null;
  finalized_at: string | null;
  // Portal 2 OCR feedback loop (Req 5, 10)
  portal2_status: string | null;
  portal2_extraction_mode: string | null;
  portal2_error_kind: string | null;
  ocr_done: boolean | null;
  ocr_confianca: number | null;
  portal2_ocr_doc_result: OcrResult;
  portal2_ocr_bill_result: OcrResult;
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
  "finalizando",
]);

/** Erros de log do bot (OCR/arquivo) — NÃO são rejeição do portal iGreen. */
function looksLikeBotDebugError(raw: string): boolean {
  const m = raw.toLowerCase();
  return (
    m.includes("isfile=") ||
    m.includes("hasimage=") ||
    m.includes("filebase64") ||
    m.includes("sandbox=") ||
    /^[a-z0-9_]+:\s*isfile=/i.test(raw.trim())
  );
}

// Tradução por Classe_de_Erro (portal2_error_kind) — mais robusta que o match
// textual, usada no banner de intervenção humana (Req 10.3, design §6).
const ERROR_KIND_LABELS: Record<string, string> = {
  duplicate_phone: "Celular já cadastrado no iGreen — pedido número alternativo ao cliente.",
  duplicate_email: "E-mail já cadastrado — pedida correção ao cliente.",
  duplicate_installation: "Nº de instalação recusado — pedida correção ao cliente.",
  duplicate_document: "❌ CPF já cadastrado no iGreen — requer ação manual.",
  no_coverage: "❌ Sem cobertura ativa para a região — requer ação manual.",
  missing_consumo: "Consumo médio não informado — pedida correção ao cliente.",
  unknown: "❌ Falha não classificada — requer ação manual.",
};

// Tradução por Classe_de_Erro; cai no texto cru quando a classe é desconhecida.
function friendlyErrorKind(kind: string | null | undefined): string | null {
  if (!kind) return null;
  return ERROR_KIND_LABELS[kind] ?? null;
}

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

/** Terminal de sucesso do portal — cobre o short-circuit "já cadastrado" do worker. */
function isPortalDone(row: Row | null): boolean {
  if (!row) return false;
  const step = String(row.conversation_step || "").toLowerCase();
  const status = String(row.status || "").toLowerCase();
  const portal2 = String(row.portal2_status || "").toLowerCase();
  if (portal2 === "already_registered") return true;
  if (
    status === "registered_igreen" ||
    status === "cadastro_concluido" ||
    status === "complete" ||
    status === "approved" ||
    status === "active"
  ) {
    return true;
  }
  if (step === "cadastro_concluido" || step === "registered_igreen") return true;
  // Worker/callback grava step=cadastro_em_analise + status terminal — não é "abrindo portal".
  if (
    step === "cadastro_em_analise" &&
    !["awaiting_otp", "portal_submitting", "validating_otp", "aguardando_otp", "validando_otp"].includes(status)
  ) {
    return true;
  }
  return false;
}

export function PortalStatusTracker({ customerId, consultantId, onRetry, defaultCollapsed = false }: Props) {
  const [row, setRow] = useState<Row | null>(null);
  const [trace, setTrace] = useState<PortalTrace | null>(null);
  const [retrying, setRetrying] = useState(false);
  const [resending, setResending] = useState(false);
  const [dismissing, setDismissing] = useState(false);
  const [markingRegistered, setMarkingRegistered] = useState(false);
  const [collapsed, setCollapsed] = useState(defaultCollapsed);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    setCollapsed(defaultCollapsed);
    setDismissed(false);
  }, [customerId, defaultCollapsed]);

  useEffect(() => {
    if (!customerId) return;
    let cancelled = false;
    const reload = async () => {
      const [{ data: cust }, { data: traces }] = await Promise.all([
        supabase
          .from("customers")
          .select("status, conversation_step, otp_code, link_assinatura, link_facial, portal2_contract_link, igreen_link, igreen_code, error_message, finalized_at, portal2_status, portal2_extraction_mode, portal2_error_kind, ocr_done, ocr_confianca, portal2_ocr_doc_result, portal2_ocr_bill_result")
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
  const status = String(row?.status || "").toLowerCase();
  const portal2Status = String(row?.portal2_status || "").toLowerCase();
  const needsHuman = portal2Status === "needs_human";
  const isAlreadyRegistered = portal2Status === "already_registered";
  const isDone = isPortalDone(row);

  // Só trata como fase de portal quando já houve envio / trilha do portal.
  // Durante a captação (ex.: aguard_conta) um error_message de log do bot
  // NÃO deve abrir o banner vermelho "Cadastro recusado".
  const inPortalPhase =
    !!row?.finalized_at ||
    ACTIVE_STEPS.has(step) ||
    needsHuman ||
    isAlreadyRegistered ||
    isDone ||
    row?.portal2_status === "failed" ||
    (trace?.status === "failed" && !!trace?.error);

  const rawErrorCandidate =
    (trace?.status === "failed" ? trace?.error : null) || row?.error_message || "";
  const usableErrorMessage =
    !!rawErrorCandidate && !looksLikeBotDebugError(rawErrorCandidate) ? rawErrorCandidate : "";

  const hasPortalError =
    needsHuman ||
    step === "worker_offline" ||
    step === "automation_failed" ||
    (trace?.status === "failed" && !!trace?.error) ||
    (inPortalPhase && !!usableErrorMessage && !isDone);

  const visible = (inPortalPhase || hasPortalError) && !dismissed;
  if (!visible) return null;

  const isOffline = step === "worker_offline" || step === "automation_failed";
  const isOtp =
    step === "aguardando_otp" ||
    step === "awaiting_otp" ||
    status === "aguardando_otp" ||
    status === "awaiting_otp";
  const isSign =
    step === "aguardando_assinatura" ||
    step === "awaiting_signature" ||
    status === "aguardando_assinatura" ||
    status === "awaiting_signature";
  const isValidating =
    step === "validando_otp" ||
    step === "validating_otp" ||
    status === "validando_otp" ||
    status === "validating_otp";

  // Banner de erro do portal tem prioridade máxima (cobre duplicate phone/cpf, etc.)
  const showError = hasPortalError && !isDone;
  const isBusySubmitting =
    !isDone &&
    !showError &&
    !isOtp &&
    !isSign &&
    !isValidating &&
    !isOffline &&
    (step === "portal_submitting" || step === "finalizando" || status === "portal_submitting");

  let icon = <Loader2 className="w-4 h-4 animate-spin text-warning" />;
  let title = "Abrindo portal no navegador da VPS…";
  let tone = "border-warning/40 bg-warning/10 text-warning";
  if (showError) { icon = <XCircle className="w-4 h-4 text-destructive" />; title = needsHuman ? "Cadastro precisa de ação manual" : "Cadastro recusado pelo portal iGreen"; tone = "border-destructive/50 bg-destructive/15 text-stone-600"; }
  else if (isOtp) { icon = <KeyRound className="w-4 h-4 text-warning" />; title = "Código enviado ao WhatsApp do cliente — aguardando digitar"; tone = "border-warning/40 bg-warning/10 text-warning"; }
  else if (isValidating) { icon = <Loader2 className="w-4 h-4 animate-spin text-info" />; title = "Validando código no portal…"; tone = "border-info/40 bg-info/10 text-info"; }
  else if (isSign) { icon = <ScanFace className="w-4 h-4 text-primary" />; title = "Link de selfie enviado ao cliente"; tone = "border-primary/40 bg-primary/10 text-primary"; }
  else if (isAlreadyRegistered) { icon = <CheckCircle2 className="w-4 h-4 text-primary" />; title = "Cliente já cadastrado no iGreen ✅"; tone = "border-primary/40 bg-primary/10 text-primary"; }
  else if (isDone) { icon = <CheckCircle2 className="w-4 h-4 text-primary" />; title = "Cadastro concluído ✅"; tone = "border-primary/40 bg-primary/10 text-primary"; }
  else if (isOffline) { icon = <AlertTriangle className="w-4 h-4 text-destructive" />; title = "Portal momentaneamente offline"; tone = "border-destructive/40 bg-destructive/10 text-stone-600"; }

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

  const resendLink = async () => {
    if (resending) return;
    setResending(true);
    try {
      const { data, error } = await supabase.functions.invoke("resend-portal-link", { body: { customerId, consultantId } });
      if (error || (data as any)?.error) throw new Error((data as any)?.message || (data as any)?.error || error?.message);
      sonnerToast.success("Link reenviado pelo bot ao cliente");
    } catch (e: any) {
      sonnerToast.error(e?.message || "Falha ao reenviar link");
    } finally { setResending(false); }
  };

  /** Consultor confirma que o cliente já está no iGreen — destrava o banner. */
  const markAlreadyRegistered = async () => {
    if (markingRegistered) return;
    setMarkingRegistered(true);
    try {
      const { error } = await supabase
        .from("customers")
        .update({
          status: "registered_igreen",
          conversation_step: "registered_igreen",
          portal2_status: "already_registered",
          error_message: null,
        } as never)
        .eq("id", customerId);
      if (error) throw error;
      setRow((prev) =>
        prev
          ? {
              ...prev,
              status: "registered_igreen",
              conversation_step: "registered_igreen",
              portal2_status: "already_registered",
              error_message: null,
            }
          : prev,
      );
      sonnerToast.success("Marcado como já cadastrado no iGreen");
    } catch (e: any) {
      sonnerToast.error(e?.message || "Falha ao marcar como cadastrado");
    } finally {
      setMarkingRegistered(false);
    }
  };

  /** Só esconde o banner nesta sessão (não altera o lead). */
  const dismissBanner = async () => {
    if (dismissing) return;
    setDismissing(true);
    setDismissed(true);
    setDismissing(false);
    sonnerToast.info("Acompanhamento do portal dispensado");
  };

  const copy = async (txt: string, label: string) => {
    try { await navigator.clipboard.writeText(txt); sonnerToast.success(`${label} copiado`); } catch {}
  };

  // Texto detalhado do erro: para needs_human, prioriza a tradução por
  // Classe_de_Erro (portal2_error_kind); senão usa trace.error / error_message.
  const rawError = usableErrorMessage;
  const kindLabel = friendlyErrorKind(row?.portal2_error_kind);
  const errorText = needsHuman
    ? (kindLabel || (rawError ? friendlyPortalError(rawError) : "Necessária ação manual no portal."))
    : (rawError ? friendlyPortalError(rawError) : "");

  // Badges de extração/IA: só quando já há dado real OU estamos no portal.
  // Evita "Extração não determinada / IA não analisou" no meio da captação.
  const extractionMode = row?.portal2_extraction_mode;
  const showExtractionBadges =
    extractionMode === "auto" ||
    extractionMode === "manual" ||
    row?.ocr_done === true ||
    isDone ||
    (inPortalPhase && (showError || isOtp || isSign || isValidating || step === "portal_submitting"));

  const extractionBadge =
    extractionMode === "auto"
      ? { label: "✅ Extração automática (IA do portal)", cls: "border-primary/40 bg-primary/10 text-primary" }
      : extractionMode === "manual"
        ? { label: "✋ Preenchimento manual", cls: "border-warning/40 bg-warning/10 text-warning" }
        : showExtractionBadges
          ? { label: "⏳ Extração em andamento", cls: "border-zinc-500/40 bg-zinc-500/10 text-zinc-900" }
          : null;

  const geminiBadge = row?.ocr_done
    ? {
        label:
          typeof row?.ocr_confianca === "number"
            ? `🤖 IA analisou (confiança ${row.ocr_confianca}%)`
            : "🤖 IA analisou (confiança indisponível)",
        cls: "border-info/40 bg-info/10 text-info",
      }
    : showExtractionBadges
      ? { label: "🤖 Aguardando análise da IA", cls: "border-zinc-500/40 bg-zinc-500/10 text-zinc-950" }
      : null;

  // ── Motivo da queda em manual (Req 5.7/5.8) ──
  // Lê apenas campos já sanitizados pelo worker; nunca reconstrói PII (Req 5.9/12.3).
  const manualReason =
    extractionMode === "manual"
      ? (row?.portal2_ocr_bill_result?.rejection_reason ||
         row?.portal2_ocr_bill_result?.error ||
         row?.portal2_ocr_doc_result?.error ||
         "motivo não disponível")
      : null;

  // ── Estado de sucesso: card grande e celebrativo ──
  if (isDone) {
    return (
      <div className="mx-3 mt-2 rounded-lg border-2 border-primary/60 bg-gradient-to-br from-primary/25 via-primary/15 to-primary/20 px-4 py-3 shadow-[0_0_36px_hsl(142_70%_45%/0.45)]">
        <div className="flex items-center gap-2">
          <CheckCircle2 className="w-6 h-6 text-primary animate-pulse" />
          <div className="flex-1">
            <p className="text-sm font-black text-primary tracking-wide leading-tight">
              {isAlreadyRegistered ? "✅ Cliente já cadastrado no iGreen" : "🎉 Cadastro aprovado pela iGreen!"}
            </p>
            <p className="text-[11px] text-primary/90 leading-tight">
              {isAlreadyRegistered
                ? "O portal reconheceu que este CPF/cliente já existe. Não é preciso reenviar."
                : "Cadastro concluído no portal. Após a sincronização da carteira, ele aparece em Clientes ativos."}
            </p>
          </div>
          <Button
            size="sm"
            variant="ghost"
            className="h-6 px-2 text-[10px] shrink-0"
            onClick={() => setDismissed(true)}
          >
            Fechar
          </Button>
        </div>
        {row?.igreen_code && (
          <div className="mt-2 flex items-center gap-2 rounded bg-primary/40 px-2 py-1.5">
            <span className="text-[10px] text-primary/80 uppercase tracking-wider font-semibold">Código iGreen</span>
            <code className="font-mono text-sm font-black text-primary flex-1">{row.igreen_code}</code>
            <Button size="sm" variant="outline" className="h-6 px-2 text-[10px] border-primary/40 text-primary hover:bg-primary/20" onClick={() => copy(row.igreen_code!, "Código")}>
              <Copy className="w-3 h-3 mr-1" /> Copiar
            </Button>
          </div>
        )}
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          {extractionBadge && (
            <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold border ${extractionBadge.cls}`}>{extractionBadge.label}</span>
          )}
          {geminiBadge && (
            <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold border ${geminiBadge.cls}`}>{geminiBadge.label}</span>
          )}
        </div>
      </div>
    );
  }

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
        {isBusySubmitting && (
          <>
            <Button
              size="sm"
              variant="outline"
              className="h-6 px-2 text-[10px]"
              disabled={markingRegistered}
              onClick={markAlreadyRegistered}
            >
              {markingRegistered ? <Loader2 className="w-3 h-3 animate-spin" /> : "Já cadastrado"}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="h-6 px-2 text-[10px]"
              disabled={dismissing}
              onClick={dismissBanner}
            >
              Dispensar
            </Button>
          </>
        )}
        <Button
          size="icon"
          variant="ghost"
          className="h-5 w-5 shrink-0"
          aria-label={collapsed ? "Expandir detalhes" : "Recolher detalhes"}
          aria-expanded={!collapsed}
          onClick={() => setCollapsed((v) => !v)}
        >
          {collapsed ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronUp className="w-3.5 h-3.5" />}
        </Button>
      </div>
      {!collapsed && (
      <>
      {isBusySubmitting && (
        <p className="mt-1.5 opacity-80 leading-snug">
          Se o portal já reconheceu o cliente, use <span className="font-semibold">Já cadastrado</span> para destravar.
        </p>
      )}
      {isOtp && row?.otp_code && (
        <div className="mt-1.5 flex items-center gap-1.5">
          <span className="opacity-80">Código recebido:</span>
          <code className="font-mono text-sm font-bold">{row.otp_code}</code>
          <Button size="icon" variant="ghost" className="h-5 w-5" onClick={() => copy(row.otp_code!, "Código")}><Copy className="w-3 h-3" /></Button>
        </div>
      )}
      {(() => {
        const portalLink = row?.link_facial || row?.link_assinatura || row?.portal2_contract_link || row?.igreen_link;
        if (!portalLink) return null;
        return (
          <div className="mt-1.5 space-y-1">
            <div className="flex items-center gap-1.5">
              <Send className="w-3 h-3 shrink-0" />
              <a href={portalLink} target="_blank" rel="noreferrer" className="underline truncate text-[11px]">{portalLink}</a>
              <Button size="icon" variant="ghost" className="h-5 w-5 shrink-0" onClick={() => copy(portalLink, "Link")}><Copy className="w-3 h-3" /></Button>
            </div>
            <div className="flex justify-end">
              <Button size="sm" variant="outline" className="h-6 px-2 text-[10px]" disabled={resending} onClick={resendLink}>
                {resending ? <Loader2 className="w-3 h-3 animate-spin" /> : <><Send className="w-3 h-3 mr-1" />Reenviar link ao cliente</>}
              </Button>
            </div>
          </div>
        );
      })()}
      {showError && errorText && (
        <p className="mt-1.5 leading-snug whitespace-pre-wrap">{errorText}</p>
      )}
      {!showError && isOffline && row?.error_message && (
        <p className="mt-1 opacity-80">{row.error_message}</p>
      )}

      {/* Extração auto/manual + IA — só quando há contexto de portal */}
      {(extractionBadge || geminiBadge) && (
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        {extractionBadge && (
          <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold border ${extractionBadge.cls}`}>
            {extractionBadge.label}
          </span>
        )}
        {geminiBadge && (
          <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold border ${geminiBadge.cls}`}>
            {geminiBadge.label}
          </span>
        )}
      </div>
      )}
      {manualReason && (
        <p className="mt-1 opacity-80 leading-snug">
          <span className="font-semibold">Motivo do manual:</span> {manualReason}
        </p>
      )}
      </>
      )}
    </div>
  );
}
