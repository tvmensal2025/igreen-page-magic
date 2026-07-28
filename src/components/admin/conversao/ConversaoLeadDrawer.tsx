import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import {
  Loader2, RefreshCw, Sparkles, Send, MessageSquare, Copy, BellOff, Clock,
  ImagePlus, Film, X, LayoutTemplate, Trophy, XCircle, UserX,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { formatStuck, priorityTier, TIER_META, type Temp } from "./score";
import type { LeadRow } from "./ConversaoCockpit";
import { CloseCaptureDialog } from "@/components/captacao/CloseCaptureDialog";
import { formatPhoneBR } from "@/lib/posVenda/format";

const TEMP_META_LABEL: Record<Temp, string> = {
  hot: "Pronto pra fechar",
  warm: "Interessado",
  cold: "Esfriando",
  dead: "Difícil recuperar",
  objection: "Travou",
  rescue: "Vale resgatar",
};

const SOURCE_LABEL: Record<string, string> = {
  rules: "Automático",
  ai_lite: "IA lite",
  ai_full: "IA completa",
  cache: "Cache",
};

interface TplOption {
  id: string;
  message_text: string;
  media_url: string | null;
  media_kind: "image" | "video" | "document" | null;
  send_order: number;
}

interface Msg {
  id: string;
  message_direction: string;
  message_text: string | null;
  message_type: string | null;
  created_at: string;
}

interface Props {
  lead: LeadRow | null;
  consultantId: string;
  onClose: () => void;
  onClassify: (customerId: string) => void;
  onReload: () => void;
  navigate: (to: string) => void;
}

export function ConversaoLeadDrawer({ lead, consultantId, onClose, onClassify, onReload, navigate }: Props) {
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [loadingMsgs, setLoadingMsgs] = useState(false);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [media, setMedia] = useState<{ url: string; kind: "image" | "video" } | null>(null);
  const [uploading, setUploading] = useState(false);
  const [templates, setTemplates] = useState<TplOption[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);
  const [closeOpen, setCloseOpen] = useState(false);
  const [closeOutcome, setCloseOutcome] = useState<"won" | "lost">("lost");
  const [closeLostReason, setCloseLostReason] = useState("sem_interesse");
  const [quickClosing, setQuickClosing] = useState(false);

  useEffect(() => {
    if (!lead) return;
    setDraft(lead.next_msg_draft ?? "");
    setMedia(null);
    setCloseOpen(false);
    loadMessages(lead.customer_id);
    loadTemplates(lead.conversation_step);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lead?.customer_id]);

  function openClose(outcome: "won" | "lost", lostReason = "sem_interesse") {
    setCloseOutcome(outcome);
    setCloseLostReason(lostReason);
    setCloseOpen(true);
  }

  async function markNotLead() {
    if (!lead || quickClosing) return;
    const ok = window.confirm(
      `Tirar "${lead.name || "esta pessoa"}" da fila?\n\nUse quando não for cliente de verdade (teste, consultor, número errado).\nO chat no WhatsApp continua — só some da Conversão.`,
    );
    if (!ok) return;
    setQuickClosing(true);
    try {
      const { data, error } = await supabase.functions.invoke("close-capture-and-register-sale", {
        body: {
          customerId: lead.customer_id,
          consultantId,
          outcome: "lost",
          lostReason: "nao_e_lead",
          notes: "Não é lead / teste — removido da fila de Conversão",
          notifyPartner: false,
        },
      });
      if (error) throw new Error(error.message || "Falha ao tirar da fila");
      const res = (data as any) || {};
      if (!res.ok && !res.alreadyClosed) throw new Error(res.error || "Falha ao tirar da fila");

      // Para de mandar automático para quem não é lead.
      await supabase
        .from("customers")
        .update({ bot_paused: true, bot_paused_reason: "nao_e_lead" } as any)
        .eq("id", lead.customer_id);

      toast.success("Saiu da fila", {
        description: "Marcado como não é lead. O WhatsApp continua disponível se precisar.",
      });
      onClose();
      onReload();
    } catch (e: any) {
      toast.error("Não deu para tirar da fila", { description: e.message });
    } finally {
      setQuickClosing(false);
    }
  }

  function handleClosedFromDialog() {
    onClose();
    onReload();
  }

  async function loadTemplates(step: string | null) {
    if (!step) { setTemplates([]); return; }
    const { data } = await (supabase as any)
      .from("reactivation_templates")
      .select("id, message_text, media_url, media_kind, send_order")
      .eq("consultant_id", consultantId)
      .eq("conversation_step", step)
      .eq("is_active", true)
      .order("send_order");
    setTemplates(((data as TplOption[]) || []));
  }

  function applyTemplate(t: TplOption) {
    setDraft(t.message_text || "");
    if (t.media_url && (t.media_kind === "image" || t.media_kind === "video")) {
      setMedia({ url: t.media_url, kind: t.media_kind });
    } else {
      setMedia(null);
    }
  }

  async function onPickFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || !lead) return;
    const isImage = file.type.startsWith("image/");
    const isVideo = file.type.startsWith("video/");
    if (!isImage && !isVideo) { toast.error("Envie imagem ou vídeo"); return; }
    if (file.size > 16 * 1024 * 1024) { toast.error("Arquivo muito grande (máx 16MB)"); return; }
    setUploading(true);
    try {
      const ext = file.name.split(".").pop() || (isImage ? "jpg" : "mp4");
      const path = `${consultantId}/reaquecimento/${crypto.randomUUID()}.${ext}`;
      const { error: upErr } = await supabase.storage.from("ai-agent-media").upload(path, file, { upsert: false, contentType: file.type });
      if (upErr) throw upErr;
      const { data: pub } = supabase.storage.from("ai-agent-media").getPublicUrl(path);
      setMedia({ url: pub.publicUrl, kind: isImage ? "image" : "video" });
      toast.success("Mídia anexada");
    } catch (err: any) {
      toast.error("Falha no upload: " + err.message);
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function loadMessages(customerId: string) {
    setLoadingMsgs(true);
    const { data } = await supabase
      .from("conversations")
      .select("id, message_direction, message_text, message_type, created_at")
      .eq("customer_id", customerId)
      .not("message_text", "like", "[__safety_ping__]%")
      .not("message_text", "like", "[inline-sent]%")
      .order("created_at", { ascending: false })
      .limit(50);
    setMsgs(((data as Msg[]) || []).reverse());
    setLoadingMsgs(false);
  }

  async function handleSend() {
    if (!lead || (!draft.trim() && !media)) return;
    setSending(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      if (!token) { toast.error("Sessão expirada — faça login de novo"); setSending(false); return; }
      const supabaseUrl = (import.meta as any).env?.VITE_SUPABASE_URL || "";
      const res = await fetch(`${supabaseUrl}/functions/v1/reactivation-send`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          mode: "single",
          customer_id: lead.customer_id,
          message_text: draft,
          media_url: media?.url ?? null,
          media_kind: media?.kind ?? null,
        }),
      });
      const data = await res.json();
      if (!res.ok || data.error) {
        toast.error("Falha ao enviar", { description: data.error || res.statusText });
      } else {
        toast.success(`Mensagem enviada para ${lead.name || "o lead"}`);
        setMedia(null);
        loadMessages(lead.customer_id);
        onReload();
      }
    } catch (e: any) {
      toast.error("Erro", { description: e.message });
    } finally {
      setSending(false);
    }
  }

  const open = !!lead;
  const tier = lead ? priorityTier(lead.score) : null;

  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="flex w-full flex-col sm:max-w-md">
        {lead && (
          <>
            <SheetHeader>
              <SheetTitle className="flex flex-wrap items-center gap-2">
                <span className="min-w-0 truncate">{lead.name || "Cliente"}</span>
                {lead.bot_paused && (
                  <span className="inline-flex items-center gap-1 rounded border border-destructive/30 bg-destructive/10 px-1.5 py-0.5 text-[10px] font-normal text-destructive">
                    <BellOff className="h-3 w-3" /> Você precisa falar
                  </span>
                )}
              </SheetTitle>
              {lead.phone && (
                <p className="text-sm font-medium tabular-nums text-foreground">
                  {formatPhoneBR(lead.phone) || lead.phone}
                </p>
              )}
              <SheetDescription className="flex flex-wrap items-center gap-2">
                {tier && <Badge variant="outline" className={TIER_META[tier].cls}>{TIER_META[tier].label}</Badge>}
                {lead.temperature && <span className="text-xs">{TEMP_META_LABEL[lead.temperature]}</span>}
                {lead.conversion_chance != null && <span className="text-xs">· {lead.conversion_chance}% de chance</span>}
                <span className="inline-flex items-center gap-1 text-xs">
                  <Clock className="h-3 w-3" />
                  {(() => {
                    const t = formatStuck(lead.hours_stuck);
                    if (t === "agora") return "Falou agora";
                    if (t === "—") return "Sem histórico";
                    return `Sem resposta há ${t}`;
                  })()}
                </span>
                {lead.classification_source && lead.classification_source !== "cache" && (
                  <span className="rounded border border-border/40 bg-muted/40 px-1.5 py-0.5 text-[10px] text-muted-foreground">
                    {SOURCE_LABEL[lead.classification_source] ?? lead.classification_source}
                  </span>
                )}
              </SheetDescription>
            </SheetHeader>

            <div className="mt-4 flex-1 space-y-4 overflow-y-auto pr-1 text-sm">
              {/* Alerta bot pausado */}
              {lead.bot_paused && (lead.temperature === "hot" || lead.temperature === "rescue") && (
                <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive">
                  Esta pessoa estava perto de fechar, mas a mensagem automática está pausada.
                  Ela não recebe lembretes sozinha — fale com ela abaixo ou no chat.
                </div>
              )}

              {/* Tirar da fila — Ganho / Perdido / Não é lead (sem apagar o WhatsApp) */}
              <div className="rounded-lg border border-border/50 bg-muted/20 p-3 space-y-2">
                <div>
                  <div className="text-[11px] font-medium text-foreground">Tirar da fila</div>
                  <p className="text-[10px] text-muted-foreground mt-0.5">
                    Some da Conversão. O chat no WhatsApp continua. Não apaga o cadastro.
                  </p>
                </div>
                <div className="grid grid-cols-3 gap-1.5">
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="h-auto flex-col gap-0.5 py-2 text-[11px] border-emerald-500/40 text-emerald-700 hover:bg-emerald-500/10 dark:text-emerald-400"
                    onClick={() => openClose("won")}
                  >
                    <Trophy className="h-3.5 w-3.5" />
                    Ganho
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="h-auto flex-col gap-0.5 py-2 text-[11px] border-rose-500/40 text-rose-700 hover:bg-rose-500/10 dark:text-rose-400"
                    onClick={() => openClose("lost", "sem_interesse")}
                  >
                    <XCircle className="h-3.5 w-3.5" />
                    Perdido
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="h-auto flex-col gap-0.5 py-2 text-[11px]"
                    disabled={quickClosing}
                    onClick={() => void markNotLead()}
                    title="Teste, consultor, número errado — não é cliente"
                  >
                    {quickClosing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <UserX className="h-3.5 w-3.5" />}
                    Não é lead
                  </Button>
                </div>
              </div>

              {/* Insight da IA */}
              {!lead.classified_at ? (
                <div className="rounded-lg border border-dashed border-border bg-muted/20 p-4 text-center text-xs text-muted-foreground">
                  Ainda sem análise. Clique para entender a situação.
                  <Button size="sm" className="mt-3 w-full" onClick={() => onClassify(lead.customer_id)}>
                    <Sparkles className="mr-1 h-3.5 w-3.5" /> Analisar agora
                  </Button>
                </div>
              ) : (
                <>
                  {lead.summary && <InsightBlock cls="border-primary/40" label="Resumo" text={lead.summary} />}
                  {lead.main_doubt && <InsightBlock cls="border-info/40" label="Dúvida principal" text={lead.main_doubt} />}
                  {lead.main_objection && <InsightBlock cls="border-warning/40" label="O que travou" text={lead.main_objection} />}
                  {lead.loss_reason && <InsightBlock cls="border-destructive/40" label="Por que esfriou" text={lead.loss_reason} />}
                  {lead.next_action && (
                    <div className="rounded-lg border border-primary/20 bg-primary/5 p-3">
                      <div className="text-[10px] uppercase text-primary">O que fazer agora</div>
                      <p className="mt-0.5 font-medium text-foreground">{lead.next_action}</p>
                    </div>
                  )}
                </>
              )}

              {/* Histórico */}
              <div>
                <div className="mb-1 text-[10px] uppercase text-muted-foreground">Histórico de mensagens</div>
                {loadingMsgs ? (
                  <div className="grid place-items-center py-4"><Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /></div>
                ) : msgs.length === 0 ? (
                  <p className="py-2 text-center text-xs text-muted-foreground">Sem mensagens registradas.</p>
                ) : (
                  <div className="max-h-[min(55vh,28rem)] min-h-72 space-y-1.5 overflow-y-auto rounded-lg border border-border/40 bg-muted/20 p-2">
                    {msgs.map((m) => {
                      const inbound = m.message_direction === "inbound";
                      const txt = m.message_text || `[${m.message_type || "evento"}]`;
                      return (
                        <div key={m.id} className={cn("rounded-md p-2 text-[11px]", inbound ? "mr-6 bg-info/10" : "ml-6 bg-primary/10 text-right")}>
                          <div className="mb-0.5 flex items-center gap-2 text-[9px] text-muted-foreground">
                            <span className="font-medium">{inbound ? "Cliente" : "Você/Bot"}</span>
                            <span>{new Date(m.created_at).toLocaleString("pt-BR")}</span>
                          </div>
                          <p className="whitespace-pre-wrap break-words">{txt.slice(0, 280)}{txt.length > 280 ? "…" : ""}</p>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>

            {/* Composer fixo embaixo */}
            <div className="border-t border-border/40 pt-3">
              {/* Templates prontos da etapa */}
              {templates.length > 0 && (
                <div className="mb-2">
                  <div className="mb-1 flex items-center gap-1 text-[10px] uppercase text-muted-foreground">
                    <LayoutTemplate className="h-3 w-3" /> Frases prontas desta etapa
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {templates.map((t, i) => (
                      <button
                        key={t.id}
                        onClick={() => applyTemplate(t)}
                        className="inline-flex items-center gap-1 rounded-md border border-border/40 bg-card px-2 py-1 text-[11px] text-muted-foreground transition hover:border-primary/40 hover:text-foreground"
                        title={t.message_text}
                      >
                        {t.media_kind === "video" ? <Film className="h-3 w-3" /> : t.media_kind === "image" ? <ImagePlus className="h-3 w-3" /> : <MessageSquare className="h-3 w-3" />}
                        Frase {i + 1}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <div className="mb-1 flex items-center justify-between">
                <span className="text-[10px] uppercase text-muted-foreground">Mensagem para enviar</span>
                {lead.next_msg_draft && (
                  <button
                    className="inline-flex items-center gap-1 text-[10px] text-primary hover:underline"
                    onClick={() => setDraft(lead.next_msg_draft!)}
                  >
                    <Copy className="h-3 w-3" /> usar sugestão
                  </button>
                )}
              </div>

              {/* Preview de mídia anexada */}
              {media && (
                <div className="group relative mb-2 overflow-hidden rounded-lg border border-border/40">
                  {media.kind === "video"
                    ? <video src={media.url} className="max-h-32 w-full object-cover" muted />
                    : <img src={media.url} alt="" className="max-h-32 w-full object-cover" />}
                  <button
                    onClick={() => setMedia(null)}
                    className="absolute right-1 top-1 rounded-full bg-black/60 p-1 text-white"
                    title="Remover mídia"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              )}

              <Textarea rows={3} value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Escreva a mensagem para esta pessoa…" />

              <div className="mt-2 flex gap-2">
                <Button variant="outline" size="icon" className="h-9 w-9 shrink-0" onClick={() => fileRef.current?.click()} disabled={uploading} title="Anexar imagem/vídeo">
                  {uploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ImagePlus className="h-3.5 w-3.5" />}
                </Button>
                <Button variant="outline" size="sm" className="flex-1" onClick={() => navigate(`/admin?tab=whatsapp&phone=${lead.phone ?? ""}`)}>
                  <MessageSquare className="mr-1 h-3.5 w-3.5" /> Abrir chat
                </Button>
                <Button size="sm" className="flex-1" onClick={handleSend} disabled={sending || (!draft.trim() && !media)}>
                  {sending ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Send className="mr-1 h-3.5 w-3.5" />}
                  Enviar
                </Button>
                <Button size="icon" variant="ghost" className="h-9 w-9" onClick={() => onClassify(lead.customer_id)} title="Analisar de novo">
                  <RefreshCw className="h-3.5 w-3.5" />
                </Button>
              </div>
              <input ref={fileRef} type="file" accept="image/*,video/*" className="hidden" onChange={onPickFile} />
            </div>

            <CloseCaptureDialog
              open={closeOpen}
              onOpenChange={setCloseOpen}
              customerId={lead.customer_id}
              consultantId={consultantId}
              defaultOutcome={closeOutcome}
              defaultLostReason={closeLostReason}
              onClosed={handleClosedFromDialog}
            />
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

function InsightBlock({ cls, label, text }: { cls: string; label: string; text: string }) {
  return (
    <div className={`border-l-2 pl-3 ${cls}`}>
      <div className="text-[10px] uppercase text-muted-foreground">{label}</div>
      <p className="text-foreground">{text}</p>
    </div>
  );
}
