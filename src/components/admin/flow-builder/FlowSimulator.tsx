import { useEffect, useMemo, useRef, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Send, RotateCw, AlertTriangle, Loader2, Paperclip, CheckCircle2, FileImage, FileText,
  Eye, Zap, Clock,
} from "lucide-react";
import { Step } from "./flowTypes";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  steps: Step[];
  consultantId?: string | null;
  consultantName?: string | null;
}

type Ev =
  | { kind: "text"; text: string; key: string; ts: number }
  | { kind: "buttons"; text: string; buttons: { id: string; title: string }[]; key: string; ts: number }
  | { kind: "audio"; url: string; key: string; ts: number }
  | { kind: "image"; url: string; caption?: string; key: string; ts: number }
  | { kind: "video"; url: string; caption?: string; key: string; ts: number }
  | { kind: "document"; url: string; caption?: string; key: string; ts: number }
  | { kind: "presence"; state: string; key: string; ts: number }
  | { kind: "lead"; text: string; attach?: { url: string; kind: string }; key: string; ts: number }
  | { kind: "system"; text: string; key: string; ts: number };

const VARIANTS: Array<"A" | "B" | "C" | "D"> = ["A", "B", "C", "D"];

// Renderizador WhatsApp (negrito, itálico, mono).
function renderWhatsApp(text: string): JSX.Element | null {
  if (!text) return null;
  const escape = (s: string) =>
    s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  let html = escape(text);
  html = html.replace(/```([\s\S]+?)```/g, '<code class="rounded bg-muted/60 px-1 py-0.5 text-[0.85em]">$1</code>');
  html = html.replace(/`([^`\n]+?)`/g, '<code class="rounded bg-muted/60 px-1 py-0.5 text-[0.85em]">$1</code>');
  html = html.replace(/(^|[^*\w])\*([^\s*][^*\n]*?[^\s*]|[^\s*])\*(?!\w)/g, "$1<strong>$2</strong>");
  html = html.replace(/(^|[^_\w])_([^\s_][^_\n]*?[^\s_]|[^\s_])_(?!\w)/g, "$1<em>$2</em>");
  html = html.replace(/(^|[^~\w])~([^\s~][^~\n]*?[^\s~]|[^\s~])~(?!\w)/g, "$1<del>$2</del>");
  return <span dangerouslySetInnerHTML={{ __html: html }} />;
}

let _ctr = 0;
const k = () => `ev_${Date.now()}_${++_ctr}`;
const nowTs = () => Date.now();

// Campos OCR conta de luz - aparecem assim que o motor extrair.
const BILL_FIELDS: Array<{ key: string; label: string; format?: (v: any) => string }> = [
  { key: "bill_holder_name", label: "Titular" },
  { key: "distribuidora", label: "Distribuidora" },
  { key: "numero_instalacao", label: "Nº Instalação" },
  { key: "electricity_bill_value", label: "Valor", format: (v) => `R$ ${Number(v).toFixed(2)}` },
  { key: "address_street", label: "Endereço" },
  { key: "address_city", label: "Cidade" },
  { key: "address_state", label: "UF" },
  { key: "cep", label: "CEP" },
];

const DOC_FIELDS: Array<{ key: string; label: string }> = [
  { key: "doc_holder_name", label: "Nome" },
  { key: "cpf", label: "CPF" },
  { key: "rg", label: "RG" },
  { key: "data_nascimento", label: "Nascimento" },
  { key: "document_type", label: "Tipo doc" },
];

const FORM_FIELDS: Array<{ key: string; label: string }> = [
  { key: "email", label: "E-mail" },
  { key: "phone_landline", label: "Telefone" },
  { key: "address_neighborhood", label: "Bairro" },
  { key: "address_number", label: "Número" },
];

function StatusDot({ filled }: { filled: boolean }) {
  return (
    <span
      className={`inline-block h-2 w-2 rounded-full ${
        filled ? "bg-primary/100" : "bg-muted-foreground/30"
      }`}
    />
  );
}

export default function FlowSimulator({ open, onOpenChange, consultantId }: Props) {
  const [events, setEvents] = useState<Ev[]>([]);
  const [freeText, setFreeText] = useState("");
  const [busy, setBusy] = useState(false);
  const [variant, setVariant] = useState<"A" | "B" | "C" | "D">("A");
  const [state, setState] = useState<any>(null);
  const [diagnostic, setDiagnostic] = useState<any>(null);
  const [turnLatencies, setTurnLatencies] = useState<number[]>([]);
  const [otpRealPhone, setOtpRealPhone] = useState(() => {
    try { return localStorage.getItem("flowSim:otpRealPhone") || ""; } catch { return ""; }
  });
  const fileRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    try { localStorage.setItem("flowSim:otpRealPhone", otpRealPhone); } catch { /* noop */ }
  }, [otpRealPhone]);

  useEffect(() => {
    if (open) handleReset(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [events]);

  function appendEvents(incoming: any[]) {
    const ts = nowTs();
    setEvents((prev) => [...prev, ...incoming.map((e) => ({ ...e, key: k(), ts }))]);
  }

  function otpPhoneDigits(): string {
    return otpRealPhone.replace(/\D/g, "");
  }

  function otpPhoneValid(): boolean {
    const d = otpPhoneDigits();
    return d.length === 0 || d.length === 12 || d.length === 13;
  }

  async function callRun(payload: any) {
    if (!otpPhoneValid()) {
      toast.error("Telefone OTP inválido — use 55 + DDD + número, ou deixe em branco");
      return;
    }
    setBusy(true);
    const startedAt = performance.now();
    try {
      const otpPhone = otpPhoneDigits();
      const { data, error } = await supabase.functions.invoke("flow-simulate-run", {
        body: {
          consultant_id: consultantId,
          variant,
          otp_real_phone: otpPhone || undefined,
          ...payload,
        },
      });
      if (error) throw error;
      const out = data as { events?: any[]; customer_state?: any; diagnostic?: any };
      const nextEvents = out.events || [];
      appendEvents(nextEvents);
      if (nextEvents.length === 0 && out.diagnostic && !out.diagnostic.advanced) {
        const ts = nowTs();
        setEvents((prev) => [
          ...prev,
          {
            kind: "system",
            text: `⚠ Motor não avançou (${out.diagnostic.step_before || "—"} → ${out.diagnostic.step_after || "—"}). ${out.diagnostic.webhook_err || "Verifique os logs."}`,
            key: k(),
            ts,
          },
        ]);
      }
      if (out.customer_state) setState(out.customer_state);
      if (out.diagnostic) setDiagnostic(out.diagnostic);
      const latency = Math.round(performance.now() - startedAt);
      setTurnLatencies((prev) => [...prev.slice(-9), latency]);
    } catch (e) {
      toast.error("Erro no simulador: " + (e as Error).message);
      setEvents((prev) => [...prev, { kind: "system", text: `⚠ ${(e as Error).message}`, key: k(), ts: nowTs() }]);
    } finally {
      setBusy(false);
    }
  }

  async function handleReset(initial = false) {
    setEvents([]);
    setState(null);
    setDiagnostic(null);
    setTurnLatencies([]);
    if (!consultantId) return;
    if (!otpPhoneValid()) {
      if (initial) {
        setEvents([{ kind: "system", text: "⚠ Telefone OTP inválido — use 55 + DDD + número (12 ou 13 dígitos) ou deixe em branco.", key: k(), ts: nowTs() }]);
      }
      return;
    }
    if (initial) {
      await callRun({ user_message: "oi", fresh: true });
      setEvents((prev) => [{ kind: "system", text: "▶ Conversa zerada — modo mock (zero pausas; OCR/Portal/OTP simulados)", key: k(), ts: nowTs() }, ...prev]);
    }
  }

  async function handleSend(text: string, button_id?: string) {
    const trimmed = text.trim();
    if (!trimmed && !button_id) return;
    setEvents((prev) => [...prev, { kind: "lead", text: trimmed || (button_id || ""), key: k(), ts: nowTs() }]);
    setFreeText("");
    await callRun({ user_message: trimmed, button_id });
  }

  async function handleFile(file: File) {
    if (!consultantId) return;
    setBusy(true);
    try {
      const ext = file.name.split(".").pop() || "bin";
      const path = `${consultantId}/${Date.now()}.${ext}`;
      const { error: upErr } = await supabase.storage
        .from("simulator-uploads")
        .upload(path, file, { upsert: false, contentType: file.type });
      if (upErr) throw upErr;
      const { data: pub } = supabase.storage.from("simulator-uploads").getPublicUrl(path);
      const url = pub.publicUrl;
      const kind: "image" | "document" = file.type.startsWith("image/") ? "image" : "document";
      setEvents((prev) => [
        ...prev,
        { kind: "lead", text: kind === "image" ? "📷 Foto enviada" : "📄 Documento enviado", attach: { url, kind }, key: k(), ts: nowTs() },
      ]);
      await callRun({ attach: { url, kind }, user_message: "" });
    } catch (e) {
      toast.error("Falha no upload: " + (e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  // ─── Computed view: dados OCR/cadastro ────────────────────────────
  const billCaptured = !!state?.electricity_bill_photo_url;
  const docCaptured = !!state?.document_front_url;
  const billHasData = billCaptured && (state?.distribuidora || state?.numero_instalacao || state?.electricity_bill_value);
  const docHasData = docCaptured && (state?.cpf || state?.rg || state?.data_nascimento);

  const avgLatency = useMemo(() => {
    if (!turnLatencies.length) return 0;
    return Math.round(turnLatencies.reduce((a, b) => a + b, 0) / turnLatencies.length);
  }, [turnLatencies]);
  const lastLatency = turnLatencies[turnLatencies.length - 1] || 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[1100px] max-h-[90vh] overflow-hidden">
        <DialogHeader className="pb-2">
          <DialogTitle className="flex items-center gap-2">
            🎬 Simulador de Fluxo — modo mock rápido
            {turnLatencies.length > 0 && (
              <Badge variant="secondary" className="text-[10px] gap-1">
                <Clock className="h-3 w-3" />
                último: {lastLatency}ms · média: {avgLatency}ms
              </Badge>
            )}
          </DialogTitle>
          <DialogDescription className="text-[11px]">
            Roda o motor real de produção com OCR/Portal mockados. Anexa imagem → OCR aparece à direita em ~1s. Nada toca CRM ou WhatsApp.
          </DialogDescription>
        </DialogHeader>

        {/* Toolbar superior compacta */}
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border bg-muted/30 px-2 py-1.5 text-xs">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-muted-foreground">Fluxo:</span>
            {VARIANTS.map((v) => (
              <Button
                key={v}
                size="sm"
                variant={variant === v ? "default" : "outline"}
                onClick={() => setVariant(v)}
                disabled={busy}
                className="h-6 px-2 text-[10px]"
              >
                {v}
              </Button>
            ))}
            {state?.conversation_step && (
              <Badge variant="outline" className="ml-2 text-[9px] truncate max-w-[200px]">
                📍 {String(state.conversation_step).slice(0, 30)}
              </Badge>
            )}
            {state?.status && (
              <Badge
                variant={["portal_submitting", "awaiting_otp", "awaiting_facial", "cadastro_concluido"].includes(state.status) ? "default" : "secondary"}
                className="text-[9px]"
              >
                {state.status}
              </Badge>
            )}
            {diagnostic && !diagnostic.webhook_ok && (
              <Badge variant="destructive" className="text-[9px]">⚠ integração</Badge>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Input
              value={otpRealPhone}
              onChange={(e) => setOtpRealPhone(e.target.value)}
              placeholder="📲 Código real (opcional)"
              disabled={busy}
              className="h-6 max-w-[170px] text-[10px]"
              title="Se preencher (55+DDD+número), o passo de confirmação envia SMS para esse telefone"
            />
            <Button size="sm" variant="outline" onClick={() => handleReset(true)} disabled={busy} className="h-6 px-2 text-[10px]">
              <RotateCw className="mr-1 h-3 w-3" /> Zerar
            </Button>
          </div>
        </div>

        {/* GRID: chat (esq) + painel OCR ao vivo (dir) */}
        <div className="grid grid-cols-1 gap-3 overflow-hidden lg:grid-cols-[1fr_360px]">
          {/* ─── COLUNA ESQUERDA: chat ─── */}
          <div className="flex flex-col gap-2 overflow-hidden">
            <div
              ref={scrollRef}
              className="min-h-[360px] flex-1 space-y-2 overflow-y-auto rounded-md border bg-muted/30 p-3 max-h-[480px]"
            >
              {events.length === 0 && (
                <p className="text-center text-xs text-muted-foreground">
                  {busy ? <Loader2 className="inline h-3 w-3 animate-spin" /> : "Aguardando…"}
                </p>
              )}
              {events.map((ev) => {
                if (ev.kind === "system") {
                  return (
                    <p key={ev.key} className="text-center text-[10px] italic text-muted-foreground">
                      {ev.text}
                    </p>
                  );
                }
                if (ev.kind === "presence") {
                  return (
                    <p key={ev.key} className="text-[10px] text-muted-foreground">
                      ▸ {ev.state === "recording" ? "🎤 gravando áudio…" : "✍️ digitando…"}
                    </p>
                  );
                }
                if (ev.kind === "lead") {
                  return (
                    <div key={ev.key} className="flex justify-end">
                      <div className="max-w-[75%] rounded-2xl rounded-tr-sm bg-primary/90 px-3 py-1.5 text-sm text-white shadow">
                        {ev.attach?.kind === "image" ? (
                          <img src={ev.attach.url} className="max-h-40 rounded-lg" />
                        ) : ev.attach ? (
                          <a href={ev.attach.url} target="_blank" rel="noreferrer" className="underline">
                            {ev.text}
                          </a>
                        ) : (
                          ev.text
                        )}
                      </div>
                    </div>
                  );
                }
                if (ev.kind === "text" || ev.kind === "buttons") {
                  return (
                    <div key={ev.key} className="flex justify-start">
                      <div className="max-w-[80%] whitespace-pre-wrap rounded-2xl rounded-tl-sm bg-card px-3 py-2 text-sm shadow">
                        {renderWhatsApp(ev.text)}
                        {ev.kind === "buttons" && ev.buttons.length > 0 && (
                          <div className="mt-2 flex flex-wrap gap-1.5">
                            {ev.buttons.map((b) => (
                              <Button
                                key={b.id}
                                size="sm"
                                variant="outline"
                                disabled={busy}
                                className="h-7 rounded-full text-xs"
                                onClick={() => handleSend(b.title, b.id)}
                              >
                                {b.title}
                              </Button>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                }
                if (ev.kind === "audio") {
                  return (
                    <div key={ev.key} className="flex justify-start">
                      <div className="rounded-2xl rounded-tl-sm bg-card p-2 shadow">
                        <audio controls src={ev.url} className="h-8 w-64" />
                      </div>
                    </div>
                  );
                }
                if (ev.kind === "image") {
                  return (
                    <div key={ev.key} className="flex justify-start">
                      <div className="rounded-2xl rounded-tl-sm bg-card p-1 shadow">
                        <img src={ev.url} alt={ev.caption || ""} className="max-h-64 max-w-xs cursor-zoom-in rounded-xl" onClick={() => window.open(ev.url, "_blank")} />
                        {ev.caption && <p className="px-2 py-1 text-xs">{ev.caption}</p>}
                      </div>
                    </div>
                  );
                }
                if (ev.kind === "video") {
                  return (
                    <div key={ev.key} className="flex justify-start">
                      <div className="rounded-2xl rounded-tl-sm bg-card p-1 shadow">
                        <video src={ev.url} controls playsInline className="max-h-72 max-w-xs rounded-xl" />
                      </div>
                    </div>
                  );
                }
                if (ev.kind === "document") {
                  return (
                    <div key={ev.key} className="flex justify-start">
                      <a href={ev.url} target="_blank" rel="noreferrer" className="rounded-2xl rounded-tl-sm bg-card px-3 py-2 text-sm underline shadow">
                        📄 {ev.caption || "Documento"}
                      </a>
                    </div>
                  );
                }
                return null;
              })}
              {busy && (
                <p className="text-center text-[10px] text-muted-foreground">
                  <Loader2 className="inline h-3 w-3 animate-spin" /> processando…
                </p>
              )}
            </div>

            {/* Quick actions: dispara mensagens prontas */}
            <div className="flex flex-wrap gap-1.5">
              {[
                { label: "👋 oi", msg: "oi" },
                { label: "💡 R$350/mês", msg: "quero economizar na conta de luz, vem uns 350 por mês" },
                { label: "📸 Quero simular", msg: "quero simular" },
                { label: "🤔 Tenho dúvida", msg: "ainda tenho dúvida, isso é golpe?" },
                { label: "🙋 Humano", msg: "quero falar com um humano" },
              ].map((qa) => (
                <Button
                  key={qa.label}
                  type="button"
                  variant="secondary"
                  size="sm"
                  className="h-7 px-2 text-[11px]"
                  disabled={busy}
                  onClick={() => handleSend(qa.msg)}
                >
                  {qa.label}
                </Button>
              ))}
            </div>

            {/* Input */}
            <div className="flex gap-2">
              <input
                ref={fileRef}
                type="file"
                accept="image/*,application/pdf"
                hidden
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) handleFile(f);
                  e.currentTarget.value = "";
                }}
              />
              <Button
                type="button"
                variant="outline"
                size="icon"
                onClick={() => fileRef.current?.click()}
                disabled={busy}
                title="Anexar foto da conta ou documento (PDF/JPG)"
              >
                <Paperclip className="h-4 w-4" />
              </Button>
              <Input
                value={freeText}
                onChange={(e) => setFreeText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && freeText.trim() && !busy) handleSend(freeText);
                }}
                placeholder="Digite uma mensagem livre…"
                maxLength={1000}
                disabled={busy}
              />
              <Button onClick={() => handleSend(freeText)} disabled={!freeText.trim() || busy}>
                {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Send className="h-3 w-3" />}
              </Button>
            </div>
          </div>

          {/* ─── COLUNA DIREITA: painel OCR ao vivo + dados ─── */}
          <aside className="flex flex-col gap-3 overflow-y-auto max-h-[600px] pr-1">
            {/* Card: OCR Conta de Luz */}
            <div className={`rounded-md border p-3 transition-all ${
              billHasData ? "border-primary/50 bg-primary/5" : billCaptured ? "border-warning/50 bg-warning/5" : "border-border bg-muted/20"
            }`}>
              <div className="mb-2 flex items-center gap-2">
                <FileImage className={`h-4 w-4 ${billHasData ? "text-primary" : billCaptured ? "text-warning" : "text-muted-foreground"}`} />
                <span className="text-xs font-semibold">Conta de luz (leitura automática)</span>
                {billHasData ? (
                  <Badge variant="default" className="ml-auto bg-primary/100 text-[9px]">
                    <CheckCircle2 className="mr-0.5 h-2.5 w-2.5" /> Extraído
                  </Badge>
                ) : billCaptured ? (
                  <Badge variant="secondary" className="ml-auto text-[9px]">
                    <Loader2 className="mr-0.5 h-2.5 w-2.5 animate-spin" /> Lendo…
                  </Badge>
                ) : (
                  <Badge variant="outline" className="ml-auto text-[9px]">Pendente</Badge>
                )}
              </div>

              {state?.electricity_bill_photo_url && (
                <div className="mb-2 overflow-hidden rounded-md border bg-card">
                  <img src={state.electricity_bill_photo_url} alt="conta" className="max-h-32 w-full object-contain" />
                </div>
              )}

              <dl className="space-y-1 text-[11px]">
                {BILL_FIELDS.map((f) => {
                  const value = state?.[f.key];
                  const has = value != null && value !== "";
                  return (
                    <div key={f.key} className="flex items-start gap-2">
                      <StatusDot filled={has} />
                      <dt className="w-24 shrink-0 text-muted-foreground">{f.label}:</dt>
                      <dd className="flex-1 truncate font-mono text-[10px]">
                        {has ? (f.format ? f.format(value) : String(value)) : <span className="italic text-muted-foreground/60">—</span>}
                      </dd>
                    </div>
                  );
                })}
              </dl>
            </div>

            {/* Card: OCR Documento */}
            <div className={`rounded-md border p-3 transition-all ${
              docHasData ? "border-primary/50 bg-primary/5" : docCaptured ? "border-warning/50 bg-warning/5" : "border-border bg-muted/20"
            }`}>
              <div className="mb-2 flex items-center gap-2">
                <FileText className={`h-4 w-4 ${docHasData ? "text-primary" : docCaptured ? "text-warning" : "text-muted-foreground"}`} />
                <span className="text-xs font-semibold">Documento (leitura automática)</span>
                {docHasData ? (
                  <Badge variant="default" className="ml-auto bg-primary/100 text-[9px]">
                    <CheckCircle2 className="mr-0.5 h-2.5 w-2.5" /> Extraído
                  </Badge>
                ) : docCaptured ? (
                  <Badge variant="secondary" className="ml-auto text-[9px]">
                    <Loader2 className="mr-0.5 h-2.5 w-2.5 animate-spin" /> Lendo…
                  </Badge>
                ) : (
                  <Badge variant="outline" className="ml-auto text-[9px]">Pendente</Badge>
                )}
              </div>

              {state?.document_front_url && state.document_front_url !== "evolution-media:pending" && (
                <div className="mb-2 overflow-hidden rounded-md border bg-card">
                  <img src={state.document_front_url} alt="doc" className="max-h-32 w-full object-contain" />
                </div>
              )}

              <dl className="space-y-1 text-[11px]">
                {DOC_FIELDS.map((f) => {
                  const value = state?.[f.key];
                  const has = value != null && value !== "";
                  return (
                    <div key={f.key} className="flex items-start gap-2">
                      <StatusDot filled={has} />
                      <dt className="w-24 shrink-0 text-muted-foreground">{f.label}:</dt>
                      <dd className="flex-1 truncate font-mono text-[10px]">
                        {has ? String(value) : <span className="italic text-muted-foreground/60">—</span>}
                      </dd>
                    </div>
                  );
                })}
              </dl>
            </div>

            {/* Card: Dados de formulário (nome, email, etc) */}
            <div className="rounded-md border border-border bg-muted/20 p-3">
              <div className="mb-2 flex items-center gap-2">
                <Eye className="h-4 w-4 text-muted-foreground" />
                <span className="text-xs font-semibold">Dados coletados</span>
              </div>
              <dl className="space-y-1 text-[11px]">
                <div className="flex items-start gap-2">
                  <StatusDot filled={!!state?.name} />
                  <dt className="w-24 shrink-0 text-muted-foreground">Nome:</dt>
                  <dd className="flex-1 truncate font-mono text-[10px]">
                    {state?.name || <span className="italic text-muted-foreground/60">—</span>}
                  </dd>
                </div>
                {FORM_FIELDS.map((f) => {
                  const value = state?.[f.key];
                  const has = value != null && value !== "";
                  return (
                    <div key={f.key} className="flex items-start gap-2">
                      <StatusDot filled={has} />
                      <dt className="w-24 shrink-0 text-muted-foreground">{f.label}:</dt>
                      <dd className="flex-1 truncate font-mono text-[10px]">
                        {has ? String(value) : <span className="italic text-muted-foreground/60">—</span>}
                      </dd>
                    </div>
                  );
                })}
                <div className="flex items-start gap-2">
                  <StatusDot filled={!!state?.otp_code} />
                  <dt className="w-24 shrink-0 text-muted-foreground">Código:</dt>
                  <dd className="flex-1 truncate font-mono text-[10px]">
                    {state?.otp_code || <span className="italic text-muted-foreground/60">—</span>}
                  </dd>
                </div>
                <div className="flex items-start gap-2">
                  <StatusDot filled={!!state?.link_facial} />
                  <dt className="w-24 shrink-0 text-muted-foreground">Link facial:</dt>
                  <dd className="flex-1 truncate font-mono text-[10px]">
                    {state?.link_facial ? "✅ gerado" : <span className="italic text-muted-foreground/60">—</span>}
                  </dd>
                </div>
              </dl>
            </div>

            {/* Card: Diagnóstico do motor */}
            {diagnostic && (
              <div className="rounded-md border border-border bg-card p-3 text-[11px]">
                <div className="mb-1 flex items-center gap-1 text-xs font-semibold">
                  <Zap className="h-3.5 w-3.5 text-primary" />
                  Motor
                </div>
                <div className="space-y-0.5 font-mono text-[10px]">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Step antes:</span>
                    <span className="truncate">{diagnostic.step_before || "—"}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Step depois:</span>
                    <span className={`truncate ${diagnostic.advanced ? "text-primary" : ""}`}>
                      {diagnostic.step_after || "—"}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Avançou:</span>
                    <span className={diagnostic.advanced ? "text-primary font-semibold" : "text-warning"}>
                      {diagnostic.advanced ? "✓ sim" : "× não"}
                    </span>
                  </div>
                  {diagnostic.webhook_err && (
                    <div className="mt-1 rounded bg-destructive/10 px-1 py-0.5 text-[10px] text-destructive">
                      {String(diagnostic.webhook_err).slice(0, 100)}
                    </div>
                  )}
                </div>
              </div>
            )}
          </aside>
        </div>

        <p className="flex items-start gap-1 text-[10px] text-muted-foreground">
          <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
          OCR e Portal mockados. Dados aparecem à direita assim que o motor processa. Cada turno volta em ~1-2s.
        </p>
      </DialogContent>
    </Dialog>
  );
}
