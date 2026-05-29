import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { CaptureLeadList } from "@/components/captacao/CaptureLeadList";
import { CaptureStepsGrid } from "@/components/captacao/CaptureStepsGrid";
import { CaptureConversationFeed } from "@/components/captacao/CaptureConversationFeed";
import { CaptureLeadCard } from "@/components/captacao/CaptureLeadCard";
import { CaptureScoreboard } from "@/components/captacao/CaptureScoreboard";
import { CaptureMissionsPanel, bumpMission } from "@/components/captacao/CaptureMissionsPanel";
import { useCaptureScoreboard } from "@/hooks/useCaptureScoreboard";
import { Button } from "@/components/ui/button";
import { ClipboardList, ExternalLink, MessageCircle, ChevronLeft, ChevronDown, ChevronUp } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { GameModeToggle } from "@/components/captacao/game/GameModeToggle";
import { GameShell } from "@/components/captacao/game/GameShell";
import { ExecHudBar } from "@/components/captacao/game/ExecHudBar";
import { AchievementsRail } from "@/components/captacao/game/AchievementsRail";

import { LevelUpOverlay } from "@/components/captacao/game/LevelUpOverlay";
import { XpToast } from "@/components/captacao/game/XpToast";
import { useGameMode } from "@/components/captacao/game/useGameMode";
import { useGameProgress } from "@/components/captacao/game/useGameProgress";
import { sfx } from "@/components/captacao/game/sfx";
import { MessageComposer } from "@/components/whatsapp/MessageComposer";
import { useTemplates } from "@/hooks/useTemplates";
import { sendWhatsAppMessage } from "@/services/messageSender";
import { toast as sonnerToast } from "sonner";
import { useCaptureSession } from "@/hooks/useCaptureSession";
import { FinalizeButton } from "@/components/captacao/FinalizeButton";
import { DragResizer } from "@/components/layout/DragResizer";



import { PortalStatusTracker } from "@/components/captacao/PortalStatusTracker";
import { HelpHint } from "@/components/ui/help-hint";

const STEPS_HELP = {
  title: "Painel de Passos do fluxo",
  summary: "Clique no avião ✈️ para enviar um passo isolado ao lead",
  details:
    "Cada linha é um passo do fluxo configurado em /admin/fluxos, na ordem 1→10. O avião verde envia somente aquele passo (texto + mídias) para o lead. O círculo com ✓ marca passos já enviados. O badge A/B/C mostra a variante do teste sendo usada com este lead.",
  example:
    "Use quando o lead pediu para repetir o áudio do passo 3 ou quando você quer pular direto para o passo de confirmação.",
} as const;

interface Props { consultantId: string; onOpenChat?: (phone: string) => void; instanceName?: string | null; isWhapi?: boolean; }

export function CaptacaoPanel({ consultantId, onOpenChat, instanceName = null, isWhapi = false }: Props) {


  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [sentSteps, setSentSteps] = useState<Set<string>>(new Set());
  const [phone, setPhone] = useState<string | null>(null);
  const [customerName, setCustomerName] = useState<string | null>(null);
  const [variant, setVariant] = useState<"A" | "B" | "C" | "D" | "E">("A");
  const [mismatch, setMismatch] = useState<{ flag: boolean; bill: string; doc: string; acked: boolean }>({ flag: false, bill: "", doc: "", acked: false });
  const [missionsVersion, setMissionsVersion] = useState(0);
  const [showAside, setShowAside] = useState(false);
  const [stepsOpen, setStepsOpen] = useState<boolean>(() => {
    try { return localStorage.getItem("cap_steps_open") === "1"; } catch { return false; }
  });
  const toggleSteps = () => setStepsOpen((v) => { const n = !v; try { localStorage.setItem("cap_steps_open", n ? "1" : "0"); } catch {} return n; });
  const { today, week, streak, bump } = useCaptureScoreboard(consultantId);
  const { toast } = useToast();
  const { templates } = useTemplates(consultantId);
  const session = useCaptureSession(selectedId);
  useEffect(() => {
    try { localStorage.removeItem("capture_auto_mode"); } catch {}
  }, []);

  // Game mode state
  const { enabled: gameOn, toggle: toggleGame, sound, toggleSound } = useGameMode(consultantId);
  const progress = useGameProgress(consultantId);
  const [xpToast, setXpToast] = useState<number | null>(null);
  const [levelUp, setLevelUp] = useState<{ level: number; label: string } | null>(null);

  useEffect(() => { setSentSteps(new Set()); setPhone(null); setCustomerName(null); setShowAside(false); setVariant("A"); setMismatch({ flag: false, bill: "", doc: "", acked: false }); }, [selectedId]);

  // Reconstitui sentSteps a partir do log de conversations outbound: tile fica ✓
  // mesmo após trocar de lead ou recarregar a página.
  useEffect(() => {
    if (!selectedId) return;
    let mounted = true;
    (async () => {
      // Pega os steps ativos do fluxo do consultor (qualquer variante) e os outbounds do lead
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
      setVariant((["A", "B", "C"].includes(v) ? v : "A") as "A" | "B" | "C" | "D" | "E");
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

  const xpReward = (kind: "text" | "audio" | "media") => {
    const res = progress.registerMessage(kind);
    setXpToast(res.gainedXp);
    sfx.coin(sound);
    if (res.leveledUp) {
      setTimeout(() => { sfx.levelUp(sound); setLevelUp({ level: res.newLevel, label: progress.rank.label }); }, 500);
    }
  };

  const sendText = async (text: string) => {
    if (!phone) { sonnerToast.error("Lead sem telefone"); return; }
    if (!instanceName) { sonnerToast.error("WhatsApp desconectado"); return; }
    const r = await sendWhatsAppMessage({ instanceName, phone, mediaCategory: "text", text, isWhapi });
    if (r.status === "failed") { sonnerToast.error(r.error || "Falha ao enviar"); return; }
    xpReward("text");
  };
  const sendAudioB64 = async (b64: string) => {
    if (!phone || !instanceName) return;
    const r = await sendWhatsAppMessage({ instanceName, phone, mediaCategory: "audio", mediaUrl: `data:audio/ogg;base64,${b64}`, isWhapi });
    if (r.status === "failed") { sonnerToast.error(r.error || "Falha ao enviar áudio"); return; }
    xpReward("audio");
  };
  const sendAudioUrl = async (url: string) => {
    if (!phone || !instanceName) return;
    const r = await sendWhatsAppMessage({ instanceName, phone, mediaCategory: "audio", mediaUrl: url, isWhapi });
    if (r.status === "failed") { sonnerToast.error(r.error || "Falha ao enviar áudio"); return; }
    xpReward("audio");
  };
  const sendMedia = async (url: string, caption: string, mediaType: "image" | "video" | "document") => {
    if (!phone || !instanceName) return;
    const fileName = mediaType === "document" ? (url.split("/").pop()?.split("?")[0] || "documento") : undefined;
    const r = await sendWhatsAppMessage({ instanceName, phone, mediaCategory: mediaType, mediaUrl: url, text: caption, fileName, isWhapi });
    if (r.status === "failed") { sonnerToast.error(r.error || "Falha ao enviar mídia"); return; }
    xpReward("media");
  };

  const handleSubmitted = async () => {
    await bump();
    bumpMission(consultantId, "leads");
    setMissionsVersion((v) => v + 1);

    if (gameOn) {
      const res = progress.registerCapture();
      setXpToast(res.gainedXp);
      sfx.coin(sound);
      if (res.leveledUp) {
        setTimeout(() => {
          sfx.levelUp(sound);
          setLevelUp({ level: res.newLevel, label: progress.rank.label });
        }, 600);
      }
      void progress.reload();
    } else {
      toast({ title: "Cadastro registrado com sucesso.", duration: 2000 });
    }
  };

  return (
    <div className={`flex flex-col flex-1 min-h-0 min-w-0 rounded-lg border ${gameOn ? "exec-border-gold exec-radial-bg" : "border-border"} overflow-hidden bg-background/60 exec-ambient`}>
      {/* Header */}
      <header className={`flex items-center justify-between px-3 py-1 border-b ${gameOn ? "border-amber-400/20" : "border-border"} bg-card/60 backdrop-blur-sm gap-2 flex-wrap shrink-0 min-h-[40px]`}>
        <div className="flex items-center gap-2 min-w-0">
          <ClipboardList className={`w-4 h-4 ${gameOn ? "text-amber-400" : "text-primary"} shrink-0`} strokeWidth={1.5} />
          <div className="min-w-0">
            <h2 className={`text-xs font-bold ${gameOn ? "uppercase tracking-wider" : ""} truncate`}>Painel de Captação</h2>
            <p className="text-[10px] text-muted-foreground truncate">
              {gameOn ? (
                <span className="flex items-center gap-1.5">
                  <span className="exec-shimmer font-black tracking-wider">MODO PERFORMANCE</span>
                  <span className="opacity-60">·</span>
                  <span className={`font-bold ${progress.rank.color}`}>{progress.rank.label}</span>
                  <span className="opacity-60">· Nv {progress.level}</span>
                </span>
              ) : "Registre clientes e acompanhe seu desempenho"}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {!gameOn && (
            <>
              <CaptureMissionsPanel consultantId={consultantId} streak={streak} bumpVersion={missionsVersion} />
              <CaptureScoreboard today={today} week={week} streak={streak} />
            </>
          )}
          <GameModeToggle enabled={gameOn} onToggle={toggleGame} sound={sound} onToggleSound={toggleSound} />
        </div>
      </header>

      {gameOn ? (
        <GameShell>
          <div className="px-2 pt-1.5 pb-1 shrink-0">
            <ExecHudBar progress={progress} />
          </div>

          <div data-resize-scope className="flex-1 min-h-0 flex flex-col md:flex-row overflow-hidden" style={{ "--cap-list-w": "12rem", "--cap-aside-w": "15rem" } as React.CSSProperties}>
            {/* Mobile: lead list visível só quando NÃO há lead selecionado. Desktop: sempre. */}
            <div className={`${selectedId ? "hidden md:flex" : "flex"} md:flex flex-col md:w-[var(--cap-list-w)] md:shrink-0 md:border-r border-border overflow-hidden`}>

              <CaptureLeadList consultantId={consultantId} selectedId={selectedId} onSelect={setSelectedId} gameOn />

            </div>
            <DragResizer storageKey="captacao-list" cssVar="cap-list-w" defaultPx={208} minPx={170} maxPx={360} />
            <main className={`${!selectedId ? "hidden md:flex" : "flex"} flex-1 flex-col overflow-hidden min-w-0 min-h-0`}>

              {!selectedId ? (
                <div className="flex-1 flex flex-col items-center justify-center gap-3 text-center p-8">
                  <ClipboardList className="w-14 h-14 text-primary/40" strokeWidth={1} />
                  <h3 className="text-base font-semibold text-foreground">Selecione um lead para iniciar</h3>
                  <p className="text-sm text-muted-foreground max-w-md">
                    Cada cadastro completo acumula pontos de performance e avança seu nível de carreira.
                  </p>
                </div>
              ) : (
                <>
                  <div className="px-3 py-1.5 border-b border-border/60 bg-card/40 flex flex-col gap-1.5 shrink-0">
                    <div className="flex items-center justify-between gap-2">
                      <Button size="icon" variant="ghost" className="md:hidden h-7 w-7 shrink-0" onClick={() => setSelectedId(null)} title="Voltar">
                        <ChevronLeft className="w-4 h-4" />
                      </Button>
                      <div className="min-w-0 flex-1">
                        <span className="text-xs font-semibold leading-tight truncate block">{customerName || phone || "—"}</span>
                      </div>
                      <div className="hidden sm:flex items-center gap-0.5 rounded-md border border-border/60 p-0.5 bg-background/40">
                        {(["A", "B", "C"] as const).map((v) => (
                          <button
                            key={v}
                            onClick={() => changeVariant(v)}
                            className={`px-1.5 py-0 text-[10px] font-bold rounded-sm transition ${variant === v ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted/40"}`}
                            title={`Fluxo variante ${v}`}
                          >
                            {v}
                          </button>
                        ))}
                      </div>
                      {phone && onOpenChat && (
                        <Button size="sm" variant="outline" className="gap-1 h-7 px-2 text-[11px] shrink-0" onClick={() => onOpenChat(phone)}>
                          <MessageCircle className="w-3 h-3" />
                          <span className="hidden lg:inline">Abrir conversa</span>
                          <ExternalLink className="w-2.5 h-2.5" />
                        </Button>
                      )}
                      <Button size="icon" variant="ghost" className="md:hidden h-7 w-7 shrink-0" onClick={() => setShowAside((s) => !s)} title="Ficha">
                        <ChevronDown className={`w-4 h-4 transition-transform ${showAside ? "rotate-180" : ""}`} />
                      </Button>
                    </div>
                    {/* Mobile A/B/C */}
                    <div className="sm:hidden flex items-center gap-1 rounded-md border border-border/60 p-0.5 bg-background/40 self-start">
                      <span className="text-[10px] text-muted-foreground px-1">Fluxo:</span>
                      {(["A", "B", "C"] as const).map((v) => (
                        <button
                          key={v}
                          onClick={() => changeVariant(v)}
                          className={`px-2 py-0.5 text-[11px] font-bold rounded-sm transition ${variant === v ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted/40"}`}
                        >
                          {v}
                        </button>
                      ))}
                    </div>
                    {mismatch.flag && !mismatch.acked && (
                      <div className="rounded-md border border-yellow-500/40 bg-yellow-500/10 px-3 py-2 text-[11px] space-y-1.5">
                        <p className="font-semibold text-yellow-200">
                          ⚠️ Nome divergente: conta "<span className="font-bold">{mismatch.bill || "—"}</span>" vs documento "<span className="font-bold">{mismatch.doc || "—"}</span>". Confirme antes de finalizar.
                        </p>
                        <div className="flex gap-2">
                          <Button size="sm" variant="outline" className="h-7 text-[11px]" onClick={() => ackMismatch("titular")}>É o titular</Button>
                          <Button size="sm" variant="outline" className="h-7 text-[11px]" onClick={() => ackMismatch("outro")}>Conta de outro titular</Button>
                        </div>
                      </div>
                    )}
                  </div>
                  <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
                    {/* Passos — colapsável para liberar espaço da conversa/composer */}
                    <div className="shrink-0 border-b border-border/40">
                      <button
                        onClick={toggleSteps}
                        className="w-full flex items-center justify-between px-2 py-1 text-[10px] font-bold uppercase tracking-wide text-muted-foreground hover:bg-secondary/40 transition"
                      >
                        <span>Passos · {sentSteps.size}/10 enviados</span>
                        {stepsOpen ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                      </button>
                      {stepsOpen && (
                        <div className="px-2 pb-1.5">
                          <CaptureStepsGrid
                            consultantId={consultantId}
                            customerId={selectedId}
                            variant={variant}
                            sentSteps={sentSteps}
                            onSent={(stepId) => { setSentSteps((s) => new Set(s).add(stepId)); sfx.ding(sound); }}
                          />
                        </div>
                      )}
                    </div>

                    {/* Conversa — flex-1 com scroll interno */}
                    <div className="flex-1 min-h-0 overflow-hidden flex flex-col p-2 gap-2">
                      <CaptureConversationFeed customerId={selectedId} gameOn />

                      {/* Ficha + Achievements aparecem no fim do scroll em mobile (quando expandidos) */}
                      <div className={`md:hidden ${showAside ? "block" : "hidden"} space-y-3`}>
                        <CaptureLeadCard customerId={selectedId} onSubmitted={handleSubmitted} sentStepsCount={sentSteps.size} embedded />
                        <AchievementsRail progress={progress} />
                      </div>
                    </div>
                  </div>

                  {/* Status do portal (VPS) — aparece após Finalizar */}
                  <PortalStatusTracker customerId={selectedId} consultantId={consultantId} />

                  {/* Finalizar Cadastro — habilita só quando tudo completo */}
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

                  {/* Composer fixo no rodapé: atalhos /, templates, fluxos, anexos, áudio, AI suggest */}
                  <div className="border-t border-border/60 bg-card/40">
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
              <DragResizer storageKey="captacao-aside" cssVar="cap-aside-w" defaultPx={240} minPx={200} maxPx={520} invert />
            {/* Desktop aside: ficha quando há lead, achievements quando não */}
            <div className="hidden md:flex md:flex-col md:w-[var(--cap-aside-w)] md:border-l border-border/60 overflow-hidden">

              {selectedId ? (
                <CaptureLeadCard customerId={selectedId} onSubmitted={handleSubmitted} sentStepsCount={sentSteps.size} />
              ) : (
                <aside className="overflow-y-auto p-2">
                  <AchievementsRail progress={progress} />
                </aside>
              )}
            </div>
          </div>
        </GameShell>
      ) : (
        <div data-resize-scope className="flex-1 min-h-0 flex flex-col md:flex-row overflow-hidden" style={{ "--cap-list-w": "12rem", "--cap-aside-w": "15rem" } as React.CSSProperties}>
          {/* Lista: full-width no mobile sem seleção; escondida no mobile com seleção; sidebar fixa em md+ */}
          <div className={`${selectedId ? "hidden md:flex" : "flex"} md:flex flex-col md:w-[var(--cap-list-w)] md:shrink-0 overflow-hidden`}>
            <CaptureLeadList consultantId={consultantId} selectedId={selectedId} onSelect={setSelectedId} />
          </div>
          <DragResizer storageKey="captacao-list" cssVar="cap-list-w" defaultPx={208} minPx={170} maxPx={360} />

          {/* Main: escondida no mobile sem seleção */}
            <main className={`${!selectedId ? "hidden md:flex" : "flex"} flex-1 flex-col overflow-hidden min-w-0 min-h-0`}>

            {!selectedId ? (
              <div className="flex-1 flex flex-col items-center justify-center gap-3 text-center p-8">
                <ClipboardList className="w-12 h-12 text-muted-foreground/30" strokeWidth={1} />
                <h3 className="text-base font-semibold">Selecione um lead para começar</h3>
                <p className="text-sm text-muted-foreground max-w-md">
                  Para adicionar um lead à captação, vá para o chat do WhatsApp, abra o cliente e marque "Capturar manualmente".
                </p>
              </div>
            ) : (
              <>
                {/* Sub-header: nome do lead + botões */}
                <div className="px-3 py-1.5 border-b border-border bg-card/40 flex items-center justify-between gap-2 shrink-0">
                  <Button size="icon" variant="ghost" className="md:hidden h-7 w-7 shrink-0" onClick={() => setSelectedId(null)} title="Voltar">
                    <ChevronLeft className="w-4 h-4" />
                  </Button>
                  <div className="min-w-0 flex-1">
                    <span className="text-xs font-semibold leading-tight truncate block">{customerName || phone || "—"}</span>
                  </div>
                  {phone && onOpenChat && (
                    <Button size="sm" variant="outline" className="gap-1 h-7 px-2 text-[11px] shrink-0" onClick={() => onOpenChat(phone)}>
                      <MessageCircle className="w-3 h-3" />
                      <span className="hidden lg:inline">Abrir conversa</span>
                      <ExternalLink className="w-2.5 h-2.5" />
                    </Button>
                  )}
                  <Button size="icon" variant="ghost" className="md:hidden h-7 w-7 shrink-0" onClick={() => setShowAside((s) => !s)} title="Ficha do lead">
                    <ChevronDown className={`w-4 h-4 transition-transform ${showAside ? "rotate-180" : ""}`} />
                  </Button>
                </div>

                {/* Desktop: passos (topo fixo) + conversa (flex-1 scroll interno) — sem scroll externo */}
                <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
                  {/* Passos — colapsável */}
                  <div className="shrink-0 border-b border-border/40">
                    <button
                      onClick={toggleSteps}
                      className="w-full flex items-center justify-between px-2 py-1 text-[10px] font-bold uppercase tracking-wide text-muted-foreground hover:bg-secondary/40 transition"
                    >
                      <span>Passos · {sentSteps.size}/10 enviados</span>
                      {stepsOpen ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                    </button>
                    {stepsOpen && (
                      <div className="px-2 pb-1.5">
                        <CaptureStepsGrid
                          consultantId={consultantId}
                          customerId={selectedId}
                          sentSteps={sentSteps}
                          onSent={(stepId) => setSentSteps((s) => new Set(s).add(stepId))}
                        />
                      </div>
                    )}
                  </div>

                  {/* Conversa — ocupa o espaço restante com scroll interno */}
                  <div className="flex-1 min-h-0 overflow-hidden flex flex-col p-2 gap-2">
                    <CaptureConversationFeed customerId={selectedId} />

                    {/* Ficha colapsável só no mobile */}
                    <div className={`md:hidden ${showAside ? "block" : "hidden"}`}>
                      <CaptureLeadCard customerId={selectedId} onSubmitted={handleSubmitted} sentStepsCount={sentSteps.size} embedded />
                    </div>
                  </div>
                </div>

                {/* Status do portal (VPS) — aparece após Finalizar */}
                <PortalStatusTracker customerId={selectedId} consultantId={consultantId} />

                {/* Finalizar Cadastro — habilita só quando tudo completo */}
                <FinalizeButton
                  consultantId={consultantId}
                  customerId={selectedId}
                  variant={variant}
                  missing={session.missing || []}
                  isComplete={!!session.isComplete}
                  allStepsSent={sentSteps.size > 0}
                  pendingStepsCount={Math.max(0, 10 - sentSteps.size)}
                />

                {/* Composer fixo no rodapé: atalhos /, templates, fluxos, anexos, áudio, AI suggest */}
                <div className="border-t border-border/60 bg-card/40">
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

          {/* Ficha desktop fixa à direita */}
          {selectedId && (
            <>
              <DragResizer storageKey="captacao-aside" cssVar="cap-aside-w" defaultPx={240} minPx={200} maxPx={520} invert />
              <div className="hidden md:flex md:w-[var(--cap-aside-w)] md:shrink-0">
                <CaptureLeadCard customerId={selectedId} onSubmitted={handleSubmitted} sentStepsCount={sentSteps.size} />
              </div>
            </>
          )}

        </div>
      )}

      {xpToast !== null && <XpToast amount={xpToast} onDone={() => setXpToast(null)} />}
      {levelUp && <LevelUpOverlay level={levelUp.level} rankLabel={levelUp.label} onClose={() => setLevelUp(null)} />}
    </div>
  );
}
