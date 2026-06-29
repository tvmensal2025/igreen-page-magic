import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { CaptureLeadList } from "@/components/captacao/CaptureLeadList";
import { CaptureStepsGrid } from "@/components/captacao/CaptureStepsGrid";
import { CaptureConversationFeed } from "@/components/captacao/CaptureConversationFeed";
import { CaptureLeadCard } from "@/components/captacao/CaptureLeadCard";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { ClipboardList, ExternalLink, MessageCircle, ChevronLeft, ChevronDown, ChevronUp, ClipboardCheck, X } from "lucide-react";
import { toast as sonnerToast } from "sonner";
import { MessageComposer } from "@/components/whatsapp/MessageComposer";
import { useTemplates } from "@/hooks/useTemplates";
import { sendWhatsAppMessage } from "@/services/messageSender";
import { useCaptureSession } from "@/hooks/useCaptureSession";
import { FinalizeButton } from "@/components/captacao/FinalizeButton";
import { DragResizer } from "@/components/layout/DragResizer";
import { PortalStatusTracker } from "@/components/captacao/PortalStatusTracker";
import { ProgressRing } from "@/components/captacao/ProgressRing";
import { WhatsAppStatusPill } from "@/components/captacao/WhatsAppStatusPill";
import { CapturedLeadsPanel } from "@/components/captacao/CapturedLeadsPanel";

interface Props { consultantId: string; onOpenChat?: (phone: string) => void; instanceName?: string | null; isWhapi?: boolean; }

export function CaptacaoPanel({ consultantId, onOpenChat, instanceName = null, isWhapi = false }: Props) {
  // Sub-aba: "cockpit" (captação manual de um lead) | "captados" (leads
  // multicanal: Meta/TikTok/landing/pesquisa B2B + disparo em massa).
  const [view, setView] = useState<"cockpit" | "captados">("cockpit");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [sentSteps, setSentSteps] = useState<Set<string>>(new Set());
  const [phone, setPhone] = useState<string | null>(null);
  const [customerName, setCustomerName] = useState<string | null>(null);
  const [variant, setVariant] = useState<"A" | "B" | "C" | "D" | "E">("A");
  // Fluxos reais do consultor (variante + nome) para o atalho dinâmico —
  // substitui o A/B/C fixo. Reflete renomeacoes feitas no construtor.
  const [flowOptions, setFlowOptions] = useState<Array<{ variant: string; name: string }>>([]);
  const [mismatch, setMismatch] = useState<{ flag: boolean; bill: string; doc: string; acked: boolean }>({ flag: false, bill: "", doc: "", acked: false });
  const [showAside, setShowAside] = useState(false);
  const [fichaOpen, setFichaOpen] = useState(false); // ficha deslizante (Cockpit)
  const [stepsOpen, setStepsOpen] = useState<boolean>(() => {
    try { return localStorage.getItem("cap_steps_open") === "1"; } catch { return false; }
  });
  const toggleSteps = () => setStepsOpen((v) => { const n = !v; try { localStorage.setItem("cap_steps_open", n ? "1" : "0"); } catch {} return n; });
  const { templates } = useTemplates(consultantId);
  const session = useCaptureSession(selectedId);

  const connected = !!instanceName;

  useEffect(() => { setSentSteps(new Set()); setPhone(null); setCustomerName(null); setShowAside(false); setVariant("A"); setMismatch({ flag: false, bill: "", doc: "", acked: false }); }, [selectedId]);

  // Carrega os fluxos ativos do consultor (variante + nome) para o atalho.
  // Reassina a tabela bot_flows para refletir criacao/renomeacao em tempo real
  // (quando o consultor muda o nome no construtor, aparece aqui na hora).
  useEffect(() => {
    let mounted = true;
    const loadFlows = async () => {
      const { data } = await supabase
        .from("bot_flows")
        .select("variant, name")
        .eq("consultant_id", consultantId)
        .eq("is_active", true)
        .order("variant", { ascending: true });
      if (!mounted) return;
      // Deduplica por variante (uma por letra), mantendo o nome.
      const seen = new Set<string>();
      const opts: Array<{ variant: string; name: string }> = [];
      for (const f of ((data as any[]) || [])) {
        const v = String(f.variant || "").toUpperCase();
        if (!v || seen.has(v)) continue;
        seen.add(v);
        opts.push({ variant: v, name: String(f.name || `Fluxo ${v}`) });
      }
      setFlowOptions(opts);
    };
    loadFlows();
    const ch = supabase
      .channel(`capt-flows-${consultantId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "bot_flows", filter: `consultant_id=eq.${consultantId}` }, loadFlows)
      .subscribe();
    return () => { mounted = false; supabase.removeChannel(ch); };
  }, [consultantId]);

  // Reconstitui sentSteps a partir do log de conversations outbound: tile fica ✓
  // mesmo após trocar de lead ou recarregar a página.
  useEffect(() => {
    if (!selectedId) return;
    let mounted = true;
    (async () => {
      const { data: flows } = await supabase
        .from("bot_flows").select("id")
        .eq("consultant_id", consultantId).eq("is_active", true);
      const flowIds = ((flows as any[]) || []).map((f) => f.id);
      if (flowIds.length === 0) return;
      const { data: steps } = await supabase
        .from("bot_flow_steps").select("id, step_key")
        .in("flow_id", flowIds).eq("is_active", true);
      const stepIdByKey = new Map<string, string>();
      ((steps as any[]) || []).forEach((s) => {
        if (s.step_key) stepIdByKey.set(String(s.step_key), String(s.id));
        stepIdByKey.set(String(s.id), String(s.id));
      });
      const { data: outs } = await supabase
        .from("conversations").select("conversation_step")
        .eq("customer_id", selectedId).eq("message_direction", "outbound")
        .not("conversation_step", "is", null);
      const found = new Set<string>();
      ((outs as any[]) || []).forEach((o) => {
        const key = String(o.conversation_step || "");
        const id = stepIdByKey.get(key);
        if (id) found.add(id);
      });
      if (mounted && found.size > 0) setSentSteps((prev) => new Set([...prev, ...found]));
    })();
    return () => { mounted = false; };
  }, [selectedId, consultantId]);

  useEffect(() => {
    if (!selectedId) return;
    void (async () => {
      const { data } = await supabase
        .from("customers")
        .select("phone_whatsapp, name, flow_variant, name_mismatch_flag, name_mismatch_acknowledged_at, bill_holder_name, doc_holder_name")
        .eq("id", selectedId).maybeSingle();
      const row = data as any;
      setPhone(row?.phone_whatsapp || null);
      setCustomerName(row?.name || null);
      const v = String(row?.flow_variant || "A").toUpperCase();
      setVariant((/^[A-Z]$/.test(v) ? v : "A") as "A" | "B" | "C" | "D" | "E");
      setMismatch({
        flag: !!row?.name_mismatch_flag,
        bill: row?.bill_holder_name || "",
        doc: row?.doc_holder_name || "",
        acked: !!row?.name_mismatch_acknowledged_at,
      });
    })();
  }, [selectedId]);

  const changeVariant = async (next: "A" | "B" | "C" | "D" | "E") => {
    if (!selectedId || next === variant) return;
    setVariant(next);
    await supabase.from("customers").update({ flow_variant: next, updated_at: new Date().toISOString() }).eq("id", selectedId);
    sonnerToast.success(`Variante ${next} ativada — próximos disparos usam esse fluxo.`);
  };

  const ackMismatch = async (relationship: "titular" | "outro") => {
    if (!selectedId) return;
    await supabase.from("customers").update({
      name_mismatch_acknowledged_at: new Date().toISOString(),
      bill_owner_relationship: relationship === "titular" ? "titular" : "outro_titular",
      updated_at: new Date().toISOString(),
    }).eq("id", selectedId);
    setMismatch((m) => ({ ...m, acked: true }));
    sonnerToast.success(relationship === "titular" ? "Titularidade confirmada — pode finalizar." : "Anotado: conta em nome de outro titular.");
  };

  const customerJid = phone ? `${phone.replace(/\D/g, "")}@s.whatsapp.net` : undefined;

  const sendText = async (text: string) => {
    if (!phone) { sonnerToast.error("Cliente interessado sem telefone"); return; }
    if (!instanceName) { sonnerToast.error("WhatsApp desconectado — reconecte para enviar"); return; }
    const r = await sendWhatsAppMessage({ instanceName, phone, mediaCategory: "text", text, isWhapi, customerId: selectedId });
    if (r.status === "failed") { sonnerToast.error(r.error || "Falha ao enviar"); return; }
    if (r.status === "pending" || r.status === "timeout") { sonnerToast.warning(r.error || "Mensagem na fila — aguardando confirmação."); return; }
  };
  const sendAudioB64 = async (b64: string) => {
    if (!phone || !instanceName) { sonnerToast.error("WhatsApp desconectado — reconecte para enviar"); return; }
    const r = await sendWhatsAppMessage({ instanceName, phone, mediaCategory: "audio", mediaUrl: `data:audio/ogg;base64,${b64}`, isWhapi, customerId: selectedId });
    if (r.status === "failed") { sonnerToast.error(r.error || "Falha ao enviar áudio"); return; }
  };
  const sendAudioUrl = async (url: string) => {
    if (!phone || !instanceName) { sonnerToast.error("WhatsApp desconectado — reconecte para enviar"); return; }
    const r = await sendWhatsAppMessage({ instanceName, phone, mediaCategory: "audio", mediaUrl: url, isWhapi, customerId: selectedId });
    if (r.status === "failed") { sonnerToast.error(r.error || "Falha ao enviar áudio"); return; }
  };
  const sendMedia = async (url: string, caption: string, mediaType: "image" | "video" | "document") => {
    if (!phone || !instanceName) { sonnerToast.error("WhatsApp desconectado — reconecte para enviar"); return; }
    const fileName = mediaType === "document" ? (url.split("/").pop()?.split("?")[0] || "documento") : undefined;
    const r = await sendWhatsAppMessage({ instanceName, phone, mediaCategory: mediaType, mediaUrl: url, text: caption, fileName, isWhapi, customerId: selectedId });
    if (r.status === "failed") { sonnerToast.error(r.error || "Falha ao enviar mídia"); return; }
  };

  const handleSubmitted = async () => {
    sonnerToast.success("Cadastro registrado com sucesso.");
  };

  // Rodapé da ficha: status do portal + botão de finalizar (acende quando completo)
  const fichaFooter = selectedId ? (
    <>
      <PortalStatusTracker customerId={selectedId} consultantId={consultantId} />
      <FinalizeButton
        consultantId={consultantId}
        customerId={selectedId}
        variant={variant}
        missing={session.missing || []}
        isComplete={!!session.isComplete}
        allStepsSent={sentSteps.size > 0}
        pendingStepsCount={Math.max(0, 10 - sentSteps.size)}
        botPaused={!!session.customer?.bot_paused}
        captureMode={session.customer?.capture_mode}
      />
    </>
  ) : null;

  return (
    <div className="flex flex-col flex-1 min-h-0 min-w-0 rounded-lg border border-border overflow-hidden bg-background/60">
      {/* Seletor de sub-aba */}
      <div className="flex items-center gap-1 px-2 py-1.5 border-b border-border bg-card/40 shrink-0">
        <button
          onClick={() => setView("cockpit")}
          className={`px-3 py-1.5 text-xs font-semibold rounded-md transition ${view === "cockpit" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted/40"}`}
        >
          Cadastrar lead
        </button>
        <button
          onClick={() => setView("captados")}
          className={`px-3 py-1.5 text-xs font-semibold rounded-md transition ${view === "captados" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted/40"}`}
        >
          Lista de leads
        </button>
      </div>

      {view === "captados" ? (
        <div className="flex-1 min-h-0 overflow-hidden p-3">
          <CapturedLeadsPanel consultantId={consultantId} instanceName={instanceName} />
        </div>
      ) : (
      <div data-resize-scope className="flex-1 min-h-0 flex flex-col md:flex-row overflow-hidden" style={{ "--cap-list-w": "13rem" } as React.CSSProperties}>
        {/* Lista de clientes */}
        <div className={`${selectedId ? "hidden md:flex" : "flex"} md:flex flex-col md:w-[var(--cap-list-w)] md:shrink-0 overflow-hidden`}>
          <CaptureLeadList consultantId={consultantId} selectedId={selectedId} onSelect={setSelectedId} />
        </div>
        <DragResizer storageKey="captacao-list" cssVar="cap-list-w" defaultPx={220} minPx={180} maxPx={360} />

        {/* Área principal */}
        <main className={`${!selectedId ? "hidden md:flex" : "flex"} flex-1 flex-col overflow-hidden min-w-0 min-h-0`}>
          {!selectedId ? (
            <div className="flex-1 flex flex-col items-center justify-center gap-3 text-center p-8">
              <ClipboardList className="w-12 h-12 text-primary/30" strokeWidth={1} />
              <h3 className="text-base font-semibold">Selecione um cliente interessado para começar</h3>
              <p className="text-sm text-muted-foreground max-w-md">
                Para adicionar um cliente interessado à captação, vá para o chat do WhatsApp, abra o cliente e marque "Capturar manualmente".
              </p>
            </div>
          ) : (
            <>
              {/* Sub-header Cockpit: duas linhas no mobile para não espremer ações */}
              <div className="px-3 py-2 border-b border-border bg-card/40 flex flex-col gap-2 shrink-0">
                <div className="flex items-center gap-2 min-w-0">
                <Button size="icon" variant="ghost" className="lg:hidden h-9 w-9 shrink-0" onClick={() => setSelectedId(null)} title="Voltar">
                  <ChevronLeft className="w-4 h-4" />
                </Button>
                <ProgressRing progress={session.progress} filled={session.filledCount} total={session.totalFields} />
                <div className="min-w-0 flex-1">
                  <span className="text-sm font-semibold leading-tight truncate block">{customerName || phone || "—"}</span>
                  <span className="text-[11px] text-muted-foreground">
                    {session.isComplete ? "Pronto para cadastrar" : `${session.filledCount} de ${session.totalFields} campos`}
                  </span>
                </div>
                <Button size="sm" variant="default" className="gap-1.5 h-9 px-3 shrink-0 lg:hidden" onClick={() => setFichaOpen(true)} title="Abrir ficha de cadastro">
                  <ClipboardCheck className="w-3.5 h-3.5" />
                  <span className="hidden md:inline">Ficha</span>
                </Button>
                {phone && onOpenChat && (
                  <Button size="sm" variant="outline" className="gap-1 h-9 px-2.5 text-[11px] shrink-0" onClick={() => onOpenChat(phone)}>
                    <MessageCircle className="w-3 h-3" />
                    <span className="hidden lg:inline">Abrir conversa</span>
                    <ExternalLink className="w-2.5 h-2.5" />
                  </Button>
                )}
                </div>
                <div className="flex items-center gap-2 overflow-x-auto scrollbar-none -mx-1 px-1 pb-0.5">
                <WhatsAppStatusPill connected={connected} />
                {/* Atalho de fluxos reais do consultor (variante + nome) */}
                <div className="flex items-center gap-0.5 rounded-md border border-border/60 p-0.5 bg-background/40 shrink-0 max-w-full overflow-x-auto">
                  {(flowOptions.length > 0 ? flowOptions : [{ variant: "A", name: "Fluxo A" }]).map((f) => (
                    <button
                      key={f.variant}
                      onClick={() => changeVariant(f.variant as "A" | "B" | "C" | "D" | "E")}
                      className={`px-2.5 py-1 text-[11px] font-semibold rounded-sm transition whitespace-nowrap min-h-[32px] ${variant === f.variant ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted/40"}`}
                      title={`Usar ${f.name}`}
                    >
                      {f.name}
                    </button>
                  ))}
                </div>
                </div>
              </div>

              {/* Aviso de nome divergente */}
              {mismatch.flag && !mismatch.acked && (
                <div className="mx-3 mt-2 rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-[11px] space-y-1.5 shrink-0">
                  <p className="font-semibold text-warning">
                    ⚠️ Nome divergente: conta "<span className="font-bold">{mismatch.bill || "—"}</span>" vs documento "<span className="font-bold">{mismatch.doc || "—"}</span>". Confirme antes de finalizar.
                  </p>
                  <div className="flex gap-2">
                    <Button size="sm" variant="outline" className="h-7 text-[11px]" onClick={() => ackMismatch("titular")}>É o titular</Button>
                    <Button size="sm" variant="outline" className="h-7 text-[11px]" onClick={() => ackMismatch("outro")}>Conta de outro titular</Button>
                  </div>
                </div>
              )}

              <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
                {/* Passos — colapsável */}
                <div className="shrink-0 border-b border-border/40">
                  <button
                    onClick={toggleSteps}
                    className="w-full flex items-center justify-between px-3 py-1.5 text-[10px] font-bold uppercase tracking-wide text-muted-foreground hover:bg-secondary/40 transition"
                  >
                    <span>Passos do roteiro · {sentSteps.size}/10 enviados</span>
                    {stepsOpen ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                  </button>
                  {stepsOpen && (
                    <div className="px-2 pb-1.5">
                      <CaptureStepsGrid
                        consultantId={consultantId}
                        customerId={selectedId}
                        variant={variant}
                        sentSteps={sentSteps}
                        onSent={(stepId) => setSentSteps((s) => new Set(s).add(stepId))}
                      />
                    </div>
                  )}
                </div>

                {/* Conversa — ocupa o espaço restante */}
                <div className="flex-1 min-h-0 overflow-hidden flex flex-col p-2 gap-2">
                  <CaptureConversationFeed customerId={selectedId} />
                </div>
              </div>

              {/* Composer */}
              <div className="border-t border-border/60 bg-card/40 shrink-0 wa-message-composer-shell relative z-20">
                <MessageComposer
                  onSend={sendText}
                  onSendAudio={sendAudioB64}
                  onSendAudioUrl={sendAudioUrl}
                  onSendMedia={sendMedia}
                  templates={templates}
                  disabled={!instanceName || !phone}
                  consultantId={consultantId}
                  customerId={selectedId || undefined}
                  customerJid={customerJid}
                  customerName={customerName || undefined}
                />
              </div>
            </>
          )}
        </main>

        {/* Ficha fixa à direita no desktop (lg+) — evita o "vazio" da conversa */}
        {selectedId && (
          <div className="hidden lg:flex lg:w-[340px] lg:shrink-0 border-l border-border/60 flex-col overflow-hidden">
            <CaptureLeadCard customerId={selectedId} onSubmitted={handleSubmitted} sentStepsCount={sentSteps.size} footer={fichaFooter} />
          </div>
        )}
      </div>
      )}

      {/* Ficha deslizante — só em telas menores (abaixo de lg); vira tela cheia no mobile */}
      <Sheet open={fichaOpen} onOpenChange={setFichaOpen}>
        <SheetContent side="right" className="w-full sm:max-w-md p-0 flex flex-col gap-0 lg:hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-border shrink-0">
            <div className="flex items-center gap-2 min-w-0">
              <ClipboardCheck className="w-4 h-4 text-primary shrink-0" />
              <div className="min-w-0">
                <SheetTitle className="text-sm font-semibold truncate">Ficha de cadastro</SheetTitle>
                <SheetDescription className="text-[11px] text-muted-foreground truncate">{customerName || phone || "Dados do cliente interessado"}</SheetDescription>
              </div>
            </div>
            <Button size="icon" variant="ghost" className="h-8 w-8 shrink-0" onClick={() => setFichaOpen(false)} aria-label="Fechar ficha">
              <X className="w-4 h-4" />
            </Button>
          </div>
          <div className="flex-1 min-h-0 overflow-hidden">
            {selectedId && (
              <CaptureLeadCard customerId={selectedId} onSubmitted={handleSubmitted} sentStepsCount={sentSteps.size} footer={fichaFooter} />
            )}
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
