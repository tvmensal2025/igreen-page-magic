import { useState, useEffect, useRef, useMemo } from "react";
import { useIsMobile } from "@/hooks/use-mobile";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { CaptureStepsList } from "./CaptureStepsList";
import { CaptureLeadCard } from "./CaptureLeadCard";
import { CaptureProgressBar } from "./CaptureProgressBar";
import { SendSequenceDialog, type SequenceStep } from "./SendSequenceDialog";
import { PortalStatusTracker } from "./PortalStatusTracker";
import { useCaptureSession, CAPTURE_FIELDS } from "@/hooks/useCaptureSession";
import { useCaptureScoreboard } from "@/hooks/useCaptureScoreboard";
import { useCaptureCombo } from "@/hooks/useCaptureCombo";
import { fireRandomCelebration, MOTIVATIONAL_PHRASES } from "@/lib/captureGame";
import { haptics } from "@/lib/haptics";
import { sfx } from "@/components/captacao/game/sfx";
import { useGameMode } from "@/components/captacao/game/useGameMode";
import { ComboTimer } from "@/components/captacao/game/ComboTimer";
import { XpFloaterProvider, useXpFloater } from "@/components/captacao/game/XpFloater";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { X, ClipboardList, ListChecks, IdCard, Loader2, Trophy, ChevronDown, ChevronUp, Maximize2, Minimize2, UserPlus, Zap } from "lucide-react";
import { askLeadName } from "@/lib/whatsapp/send";

interface Props {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  consultantId: string;
  customerId: string;
  customerName?: string | null;
  phoneNumber?: string | null;
  /** Quando true, renderiza como painel lateral inline (sem overlay/Sheet). Usado em desktop dentro do ChatView. */
  inline?: boolean;
}

export function CaptureSheet(props: Props) {
  // Wrap everything in the XP floater provider so child components can
  // call `useXpFloater().show(amount)` whenever a field is captured or a
  // combo bonus fires. Mounting it here (instead of at App root) keeps
  // the floater scoped to the captação modal — when the sheet closes,
  // pending floats are cleaned up too.
  return (
    <XpFloaterProvider>
      <CaptureSheetInner {...props} />
    </XpFloaterProvider>
  );
}

function CaptureSheetInner({ open, onOpenChange, consultantId, customerId, customerName, phoneNumber, inline = false }: Props) {
  const { customer, filledCount, totalFields, progress, validation } = useCaptureSession(customerId);
  const { bump } = useCaptureScoreboard(consultantId);
  const combo = useCaptureCombo();
  const xpFloater = useXpFloater();
  const { sound } = useGameMode(consultantId);
  const { toast } = useToast();
  const [sentSteps, setSentSteps] = useState<Set<string>>(new Set());
  const [tab, setTab] = useState<"passos" | "ficha">("passos");
  const [submitting, setSubmitting] = useState(false);
  const isMobile = useIsMobile();
  const [minimized, setMinimized] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [allSteps, setAllSteps] = useState<SequenceStep[]>([]);
  const [seqOpen, setSeqOpen] = useState(false);
  const [askNotice, setAskNotice] = useState(false);
  const lastCountRef = useRef(0);

  // No mobile o painel abre minimizado (pílula no rodapé) pra não tampar o teclado/composer.
  // Mas quando o consultor expande, vai direto pra fullscreen (sem estado compacto intermediário).
  // Mobile: começa minimizado (barra fina), abre em meia-tela. Grabber arrasta pra cima → fullscreen.
  useEffect(() => { setSentSteps(new Set()); setMinimized(isMobile); setExpanded(false); }, [customerId, isMobile]);
  const pendingSteps = useMemo(() => allSteps.filter((s) => !sentSteps.has(s.step_key)), [allSteps, sentSteps]);
  useEffect(() => { if (open) { setMinimized(isMobile); setExpanded(false); } else { setMinimized(false); setExpanded(false); } }, [open, isMobile]);

  // Garante modo manual ao abrir
  useEffect(() => {
    if (!open || !customer) return;
    if (customer.capture_mode !== "manual") {
      void supabase.from("customers")
        .update({ capture_mode: "manual", capture_started_at: new Date().toISOString() })
        .eq("id", customer.id);
    }
  }, [open, customer]);

  useEffect(() => {
    if (!customer) return;
    if (filledCount > lastCountRef.current) {
      const phrase = MOTIVATIONAL_PHRASES[filledCount];
      if (phrase) toast({ title: phrase, duration: 1800 });

      // 🎮 Game feedback layer — dispara em cada CAPTURA de campo:
      //   1. Haptic feedback (mobile) — vibração curta de 40ms
      //   2. SFX ding (se som ligado pelo consultor)
      //   3. XP floater: número subindo da barra ("+10 XP")
      //   4. Combo: se já passou do 1º campo, soma multiplicador (visual)
      //
      // Em milestones (5, 8, 10) eleva o feedback: success haptic + coin SFX.
      const isMilestone = filledCount === 5 || filledCount === 8 || filledCount === totalFields;
      if (isMilestone) {
        haptics.success();
        sfx.coin(sound);
      } else {
        haptics.tap();
        sfx.ding(sound);
      }

      // XP floater visível para o consultor — incentiva o "vício" do XP
      // que vai crescendo a cada toque.
      const xpGain = isMilestone ? 25 : 10;
      xpFloater.show(xpGain);
    }
    lastCountRef.current = filledCount;
  }, [filledCount, customer, toast, totalFields, sound, xpFloater]);

  const billHasData = !!(customer as any)?.numero_instalacao || !!(customer as any)?.address_street || !!(customer as any)?.bill_holder_name;
  const docHasData = !!(customer as any)?.cpf || !!(customer as any)?.rg;
  const billConfirmed = !billHasData || !!(customer as any)?.bill_data_confirmed_at;
  const docConfirmed = !docHasData || !!(customer as any)?.doc_data_confirmed_at;
  const allConfirmed = billConfirmed && docConfirmed;
  // canSubmit usa a validação canônica do Portal — bloqueia tanto faltantes
  // quanto inválidos (CPF errado, R$/kWh fora da faixa, etc.). Antes era só
  // "filledCount === totalFields", o que deixava media_consumo passar com
  // valor zero/null e o portal rejeitava silenciosamente.
  const canSubmit = !!validation?.ok && allConfirmed;
  const phrase = MOTIVATIONAL_PHRASES[filledCount] || `Faltam ${totalFields - filledCount} dados 💪`;
  const nextMissing = validation?.missing?.[0]
    ? { key: validation.missing[0].key, label: validation.missing[0].label }
    : null;

  // Lista descritiva do que falta/está errado pro tooltip do botão final.
  const missingFieldLabels = (validation?.missing || []).map((m) => m.label);
  const invalidLabels = (validation?.invalid || []).map((i) => `${i.label}: ${i.reason}`);
  const submitTooltip = canSubmit
    ? "Enviar pro portal (VPS + OTP)"
    : [
        missingFieldLabels.length > 0 ? `Faltam: ${missingFieldLabels.slice(0, 3).join(", ")}${missingFieldLabels.length > 3 ? "…" : ""}` : "",
        invalidLabels.length > 0 ? `Inválido: ${invalidLabels.slice(0, 2).join(" · ")}` : "",
        !billConfirmed ? "Confirmar dados da conta de luz" : "",
        !docConfirmed ? "Confirmar dados do documento" : "",
      ].filter(Boolean).join(" · ");

  const runFinalize = async (sendNotice: boolean) => {
    if (!customer || !canSubmit) return;
    setSubmitting(true);
    try {
      const { data, error } = await supabase.functions.invoke("finalize-capture", {
        body: { customerId: customer.id, consultantId, sendNotice },
      });
      if (error) throw new Error(error.message || "Falha ao enviar ao portal");
      const res = (data as any) || {};
      if (res.error && res.mode !== "queued_offline") {
        const msg = res.error === "incomplete"
          ? `Faltam dados: ${(res.missing || []).join(", ")}`
          : String(res.error);
        throw new Error(msg);
      }

      // 🏆 Cadastro completo — 5 efeitos combinados:
      //   1. Confetti aleatório (já existia)
      //   2. Bump scoreboard
      //   3. Triple-vibration (victory haptic) no celular
      //   4. SFX level-up
      //   5. Combo bumped — premia o próximo cadastro
      //   6. XP floater grande (+100 XP CADASTRO!)
      fireRandomCelebration();
      haptics.victory();
      sfx.levelUp(sound);
      const c = combo.onCapture();
      xpFloater.show(100 + c.bonusXp, c.level >= 2 ? `COMBO x${c.level}` : undefined);
      await bump();

      if (res.already) {
        toast({ title: "Lead já está em processamento no portal.", duration: 3000 });
      } else if (res.mode === "queued_offline") {
        toast({ title: "Portal com falha", description: "O erro vai aparecer no painel para reenviar.", variant: "destructive", duration: 5000 });
      } else {
        toast({ title: "🎉 Cadastro enviado!", description: "Portal Worker concluindo…", duration: 3500 });
      }
    } catch (e: any) {
      haptics.error();
      toast({ title: "Erro", description: e?.message || String(e), variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  };

  const handleSubmit = () => {
    if (!customer || !canSubmit || submitting) return;
    if ((customer.capture_mode || "manual") === "manual" && !!customer.bot_paused) {
      setAskNotice(true);
      return;
    }
    void runFinalize(true);
  };

  const disableCapture = async () => {
    // Apenas fecha o painel — modo Captação fica ligado para todos os leads.
    toast({ title: "Painel fechado", description: "A captação continua ativa em segundo plano." });
    onOpenChange(false);
  };

  const [askingName, setAskingName] = useState(false);
  // Alinhado com manual-step-send: nome do perfil do WhatsApp NÃO conta como capturado.
  const _nSrc = String((customer as any)?.name_source || ((customer as any)?.name ? "whatsapp_profile" : "")).toLowerCase();
  const needsName = ["", "unknown", "whatsapp_profile"].includes(_nSrc);
  const handleAskName = async () => {
    if (!customer) return;
    setAskingName(true);
    try {
      await askLeadName({ consultantId, customerId: customer.id, phoneHint: phoneNumber || undefined });
    } finally {
      setAskingName(false);
    }
  };

  // ⌨️ Atalhos de teclado (desktop only — mobile virtual keyboard ignora):
  //   Esc        → minimiza painel
  //   1..9, 0    → seleciona campo correspondente da ficha (vai pra tab "ficha")
  //   E          → vai pra tab "passos"
  //   C          → cadastrar (se canSubmit)
  //   M          → maximiza/minimiza
  //
  // Sem isso, no PC a navegação é 100% mouse — perde-se velocidade contra
  // o ritmo do bot/atendimento.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      // Não bloqueia se usuário está digitando em input/textarea/contenteditable.
      const target = e.target as HTMLElement | null;
      const isTyping = target && (
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.isContentEditable
      );
      if (isTyping) return;

      if (e.key === "Escape") {
        e.preventDefault();
        setMinimized(true);
        return;
      }
      if (e.key.toLowerCase() === "m") {
        e.preventDefault();
        setExpanded((v) => !v);
        return;
      }
      if (e.key.toLowerCase() === "e") {
        e.preventDefault();
        setTab("passos");
        return;
      }
      if (e.key.toLowerCase() === "c" && canSubmit && !submitting) {
        e.preventDefault();
        void handleSubmit();
        return;
      }
      // 1..9 / 0 → ficha + scrollar pro campo correspondente
      if (/^[0-9]$/.test(e.key)) {
        const idx = e.key === "0" ? 9 : parseInt(e.key, 10) - 1;
        const field = CAPTURE_FIELDS[idx];
        if (field) {
          e.preventDefault();
          setTab("ficha");
          setTimeout(() => {
            const el = document.querySelector(`[data-capture-field="${field.key}"]`) as HTMLElement | null;
            if (el) {
              el.scrollIntoView({ behavior: "smooth", block: "center" });
              const focusable = el.querySelector<HTMLElement>("input, textarea, button");
              focusable?.focus();
            }
          }, 100);
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, canSubmit, submitting]); // eslint-disable-line react-hooks/exhaustive-deps

  // Sinaliza no <body> quando a barra minimizada está visível, para que o
  // layout do WhatsApp possa reservar espaço no rodapé e o composer não
  // fique coberto pela barra fixa de Captação.
  useEffect(() => {
    const showingBar = open && minimized && !inline;
    if (showingBar) {
      document.body.dataset.captacaoBarOpen = "1";
    } else {
      delete document.body.dataset.captacaoBarOpen;
    }
    return () => {
      delete document.body.dataset.captacaoBarOpen;
    };
  }, [open, minimized, inline]);

  // ────────────────────────────────────────────────────────────────────────
  // INLINE (desktop): painel lateral integrado, sem Sheet/overlay/minimized.
  // Usado dentro do ChatView do WhatsApp em telas md+ — fica numa coluna
  // à direita do chat, sempre visível, sem cobrir mensagens nem composer.
  // ────────────────────────────────────────────────────────────────────────
  if (inline) {
    if (!open) return null;
    return (
      <aside className="w-full h-full flex flex-col bg-background border-l border-border/60 overflow-hidden">
        <header className="px-2 py-1.5 border-b border-border/60 bg-gradient-to-br from-primary/10 via-card to-card sticky top-0 z-20">
          <div className="flex items-center gap-1.5 mb-1.5">
            <div className="w-7 h-7 rounded-full bg-primary/15 flex items-center justify-center shrink-0">
              <ClipboardList className="w-3.5 h-3.5 text-primary" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-xs font-bold leading-tight break-words">
                {customerName || phoneNumber || "Lead"}
              </p>
              {phoneNumber && <p className="text-[10px] text-muted-foreground truncate">{phoneNumber}</p>}
            </div>
            {needsName && (
              <Button
                size="sm"
                variant="default"
                className="gap-1 font-bold animate-pulse shrink-0 h-7 px-2 text-[10px]"
                onClick={handleAskName}
                disabled={askingName}
                title="Lead sem nome — peça agora"
              >
                {askingName ? <Loader2 className="w-3 h-3 animate-spin" /> : <UserPlus className="w-3 h-3" />}
                Nome
              </Button>
            )}
            <Button size="icon" variant="ghost" className="h-7 w-7 shrink-0" onClick={() => onOpenChange(false)} title="Fechar painel">
              <X className="w-4 h-4" />
            </Button>
          </div>
          <CaptureProgressBar progress={progress} filled={filledCount} total={totalFields} />
          <p className="text-[10px] text-center font-semibold text-primary/90 mt-1">{phrase}</p>
          {nextMissing && !canSubmit && (
            <p className="text-[10px] text-center mt-0.5 text-muted-foreground">
              🎯 Próximo: <span className="font-bold text-foreground">{nextMissing.label}</span>
            </p>
          )}
          {combo.isActive && (
            <div className="mt-1.5">
              <ComboTimer
                level={combo.level}
                secondsLeft={combo.secondsLeft}
                progressPct={combo.progressPct}
                bonusXp={combo.bonusXp}
              />
            </div>
          )}
        </header>

        <Tabs value={tab} onValueChange={(v) => setTab(v as any)} className="flex-1 flex flex-col overflow-hidden">
          <TabsList className="mx-2 mt-1.5 grid grid-cols-2 h-8">
            <TabsTrigger value="passos" className="gap-0.5 text-[11px]">
              <ListChecks className="w-3 h-3" /> Passos
              <span className="ml-0.5 bg-primary/15 px-1 py-px rounded-full font-bold text-[9px]">{sentSteps.size}</span>
            </TabsTrigger>
            <TabsTrigger value="ficha" className="gap-0.5 text-[11px]">
              <IdCard className="w-3 h-3" /> Ficha
              <span className="ml-0.5 bg-primary/15 px-1 py-px rounded-full font-bold text-[9px]">{filledCount}/{totalFields}</span>
            </TabsTrigger>
          </TabsList>

          <TabsContent value="passos" className="flex-1 overflow-y-auto px-2 py-1.5 mt-1.5 mb-0 data-[state=inactive]:hidden">
            <CaptureStepsList
              consultantId={consultantId}
              customerId={customerId}
              sentSteps={sentSteps}
              onSent={async (key) => {
                setSentSteps((s) => new Set(s).add(key));
              }}
              defaultVariant={(customer as any)?.flow_variant || "A"}
              currentStep={(customer as any)?.conversation_step}
              onStepsLoaded={setAllSteps}
            />
          </TabsContent>

          <TabsContent value="ficha" className="flex-1 overflow-hidden p-0 mt-1 mb-0 data-[state=inactive]:hidden">
            <FichaWrap customerId={customerId} />
          </TabsContent>
        </Tabs>

        <footer className="border-t border-border/60 bg-card/80 backdrop-blur sticky bottom-0 z-20 p-2 space-y-1.5">
          <PortalStatusTracker customerId={customerId} consultantId={consultantId} />
          {customer?.conversation_step && ["finalizando", "portal_submitting", "aguardando_otp", "validando_otp"].includes(customer.conversation_step) && (
            <p className="text-[10px] text-center text-primary font-semibold animate-pulse">
              🚀 Portal: {customer.conversation_step.replace("_", " ")}…
            </p>
          )}
          <div className="flex items-center gap-1">
            <Button
              variant="outline"
              size="sm"
              className="shrink-0 gap-1 font-bold h-9 px-2 text-[10px]"
              onClick={() => setSeqOpen(true)}
              disabled={pendingSteps.length === 0 || needsName}
              title={needsName ? "Peça o nome do lead primeiro" : pendingSteps.length === 0 ? "Tudo enviado" : `Disparar ${pendingSteps.length} passos pendentes`}
            >
              <Zap className="w-3.5 h-3.5" /> Enviar tudo ({pendingSteps.length})
            </Button>
            <Button
              size="lg"
              className={`flex-1 font-bold gap-1 h-9 text-xs ${
                canSubmit
                  ? "bg-gradient-to-r from-emerald-500 to-emerald-600 text-white hover:opacity-95 animate-exec-energy shadow-lg shadow-emerald-500/30"
                  : "bg-muted text-muted-foreground opacity-60 cursor-not-allowed hover:bg-muted"
              }`}
              onClick={handleSubmit}
              disabled={submitting || !canSubmit}
              title={submitTooltip}
            >
              {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trophy className="w-4 h-4" />}
              {canSubmit ? "CADASTRAR" : `${filledCount}/${totalFields}${!billConfirmed ? " ·📄" : ""}${!docConfirmed ? " ·🪪" : ""}`}
            </Button>
          </div>
        </footer>

        <SendSequenceDialog
          open={seqOpen}
          onOpenChange={setSeqOpen}
          consultantId={consultantId}
          customerId={customerId}
          customerName={customerName || phoneNumber}
          steps={pendingSteps}
          variant={(((customer as any)?.flow_variant || "A").toUpperCase()) as "A" | "B" | "C" | "D" | "E"}
          onStepSent={(key) => setSentSteps((s) => new Set(s).add(key))}
          onAskName={handleAskName}
        />
        <FinalizeNoticeDialog
          open={askNotice}
          onOpenChange={setAskNotice}
          onWithoutNotice={() => void runFinalize(false)}
          onWithNotice={() => void runFinalize(true)}
        />
      </aside>
    );
  }

  // Barra fina minimizada — h-11, tap em qualquer lugar abre meia-tela.
  if (open && minimized) {
    return (
      <button
        type="button"
        onClick={() => setMinimized(false)}
        className="fixed bottom-0 left-0 right-0 z-50 flex items-center gap-2 px-3 h-11 bg-card/95 backdrop-blur border-t border-primary/40 shadow-[0_-6px_20px_-6px_hsl(var(--primary)/0.35)] animate-in slide-in-from-bottom-2 active:bg-card"
        style={{ paddingBottom: "max(0px, env(safe-area-inset-bottom, 0px))" }}
      >
        <div className="w-7 h-7 rounded-full bg-primary text-primary-foreground flex items-center justify-center shrink-0">
          <ClipboardList className="w-4 h-4" />
        </div>
        <div className="flex-1 min-w-0 text-left">
          <p className="text-xs font-semibold leading-tight truncate">
            Captação {filledCount}/{totalFields}
            <span className="text-muted-foreground font-normal"> · {sentSteps.size}/10 passos</span>
          </p>
        </div>
        {combo.isActive && (
          <ComboTimer level={combo.level} secondsLeft={combo.secondsLeft} progressPct={combo.progressPct} bonusXp={combo.bonusXp} compact />
        )}
        <div className="w-9 h-9 rounded-full bg-primary text-primary-foreground flex items-center justify-center shrink-0">
          <Maximize2 className="w-4 h-4" />
        </div>
      </button>
    );
  }


  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        hideCloseButton
        overlayClassName={expanded ? undefined : "bg-transparent pointer-events-none"}
        onInteractOutside={(e) => { if (!expanded) e.preventDefault(); }}
        onPointerDownOutside={(e) => { if (!expanded) e.preventDefault(); }}
        className={`w-full p-0 flex flex-col gap-0 border-0 bg-background sm:max-w-none shadow-[0_-12px_40px_-12px_hsl(var(--primary)/0.35)] ${
          expanded
            ? "h-[100dvh] rounded-none"
            : isMobile
              ? "h-[50dvh] min-h-[280px] max-h-[100dvh] rounded-t-2xl"
              : "h-[28dvh] min-h-[200px] max-h-[100dvh] rounded-t-2xl"
        }`}
      >
        {/* Grabber — arraste pra cima vira fullscreen, pra baixo minimiza */}
        <div
          className="flex flex-col items-center pt-2 pb-1 shrink-0 cursor-grab active:cursor-grabbing touch-none"
          onTouchStart={(e) => { (e.currentTarget as any)._startY = e.touches[0].clientY; }}
          onTouchMove={(e) => {
            const start = (e.currentTarget as any)._startY;
            if (typeof start === "number") {
              const dy = e.touches[0].clientY - start;
              if (dy > 60) { setMinimized(true); (e.currentTarget as any)._startY = undefined; }
              else if (dy < -60) { setExpanded(true); (e.currentTarget as any)._startY = undefined; }
            }
          }}
          title="Arraste pra cima pra expandir, pra baixo pra minimizar"
        >
          <div className="w-12 h-1.5 rounded-full bg-muted-foreground/50" />
        </div>


        {/* Header */}
        <header className={`px-2 border-b border-border/60 bg-gradient-to-br from-primary/10 via-card to-card sticky top-0 z-20 ${expanded ? "pt-2 pb-2" : "py-0.5"}`}>
          <div className={`flex items-center gap-1.5 ${expanded ? "mb-2" : ""}`}>
            <div className={`rounded-full bg-primary/15 flex items-center justify-center shrink-0 ${expanded ? "w-9 h-9" : "w-6 h-6"}`}>
              <ClipboardList className={`text-primary ${expanded ? "w-4 h-4" : "w-3 h-3"}`} />
            </div>
            <div className="flex-1 min-w-0">
              <p className={`font-bold truncate ${expanded ? "text-sm" : "text-[11px] leading-tight"}`}>
                {customerName || phoneNumber || "Lead"}
              </p>
              {phoneNumber && expanded && <p className="text-[10px] text-muted-foreground truncate">{phoneNumber}</p>}
            </div>
            {needsName && (
              <Button
                size="sm"
                variant="default"
                className={`gap-1 font-bold animate-pulse shrink-0 ${expanded ? "h-9 px-3 text-xs" : "h-7 px-2 text-[10px]"}`}
                onClick={handleAskName}
                disabled={askingName}
                title="Lead sem nome — peça agora"
              >
                {askingName ? <Loader2 className="w-3 h-3 animate-spin" /> : <UserPlus className="w-3 h-3" />}
                Nome
              </Button>
            )}
            <div className="flex items-center gap-0.5 shrink-0">
              {!isMobile && (
                <Button size="icon" variant="ghost" className={expanded ? "h-9 w-9" : "h-7 w-7"} onClick={() => setExpanded((v) => !v)} title={expanded ? "Recolher" : "Expandir"}>
                  {expanded ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-3.5 h-3.5" />}
                </Button>
              )}
              <Button size="icon" variant="ghost" className={expanded ? "h-10 w-10" : "h-7 w-7"} onClick={() => setMinimized(true)} title="Minimizar">
                <ChevronDown className={expanded ? "w-5 h-5" : "w-4 h-4"} />
              </Button>
              <Button size="icon" variant="ghost" className={expanded ? "h-10 w-10" : "h-7 w-7"} onClick={() => onOpenChange(false)} title="Fechar">
                <X className={expanded ? "w-5 h-5" : "w-4 h-4"} />
              </Button>
            </div>
          </div>
          {expanded && (
            <>
              <CaptureProgressBar progress={progress} filled={filledCount} total={totalFields} />
              <p className="text-[11px] text-center font-semibold text-primary/90 mt-1.5">{phrase}</p>
              {nextMissing && !canSubmit && (
                <p className="text-[11px] text-center mt-0.5 text-muted-foreground">
                  🎯 Próximo: <span className="font-bold text-foreground">{nextMissing.label}</span>
                </p>
              )}
              <p className="text-[10px] text-center mt-0.5 text-muted-foreground">
                Passo {sentSteps.size} de 10 enviado
              </p>
              {/* 🔥 Combo timer — só aparece quando combo ativo. Mostra
                  multiplicador, countdown e bonus XP do próximo cadastro. */}
              {combo.isActive && (
                <div className="mt-2">
                  <ComboTimer
                    level={combo.level}
                    secondsLeft={combo.secondsLeft}
                    progressPct={combo.progressPct}
                    bonusXp={combo.bonusXp}
                  />
                </div>
              )}
            </>
          )}
        </header>

        {/* Tabs */}
        <Tabs value={tab} onValueChange={(v) => setTab(v as any)} className="flex-1 flex flex-col overflow-hidden">
          <TabsList className={`mx-2 grid grid-cols-2 ${expanded ? "mt-2 h-9" : "mt-0.5 h-6"}`}>
            <TabsTrigger value="passos" className={`gap-0.5 ${expanded ? "text-[11px]" : "text-[10px]"}`}>
              <ListChecks className={expanded ? "w-3 h-3" : "w-2.5 h-2.5"} /> Passos
              <span className={`ml-0.5 bg-primary/15 px-1 py-px rounded-full font-bold ${expanded ? "text-[9px]" : "text-[8px]"}`}>{sentSteps.size}</span>
            </TabsTrigger>
            <TabsTrigger value="ficha" className={`gap-0.5 ${expanded ? "text-[11px]" : "text-[10px]"}`}>
              <IdCard className={expanded ? "w-3 h-3" : "w-2.5 h-2.5"} /> Ficha
              <span className={`ml-0.5 bg-primary/15 px-1 py-px rounded-full font-bold ${expanded ? "text-[9px]" : "text-[8px]"}`}>{filledCount}/{totalFields}</span>
            </TabsTrigger>
          </TabsList>

          <TabsContent value="passos" className={`flex-1 overflow-y-auto ${expanded ? "p-3 mt-2" : "px-1.5 py-1 mt-0.5"} mb-0 data-[state=inactive]:hidden`}>
            <CaptureStepsList
              consultantId={consultantId}
              customerId={customerId}
              sentSteps={sentSteps}
              onSent={async (key) => {
                setSentSteps((s) => new Set(s).add(key));
              }}
              defaultVariant={(customer as any)?.flow_variant || "A"}
              currentStep={(customer as any)?.conversation_step}
              onStepsLoaded={setAllSteps}
            />
          </TabsContent>

          <TabsContent value="ficha" className="flex-1 overflow-hidden p-0 mt-1 mb-0 data-[state=inactive]:hidden">
            <FichaWrap customerId={customerId} />
          </TabsContent>
        </Tabs>

        {/* Footer — 1 linha só no compacto */}
        <footer
          className={`border-t border-border/60 bg-card/80 backdrop-blur sticky bottom-0 z-20 ${expanded ? "p-3 space-y-2" : "px-2 py-1"}`}
          style={{ paddingBottom: "max(0.25rem, env(safe-area-inset-bottom, 0px))" }}
        >
          <PortalStatusTracker customerId={customerId} consultantId={consultantId} />
          {customer?.conversation_step && ["finalizando", "portal_submitting", "aguardando_otp", "validando_otp"].includes(customer.conversation_step) && (
            <p className="text-[10px] text-center text-primary font-semibold animate-pulse">
              🚀 Portal: {customer.conversation_step.replace("_", " ")}…
            </p>
          )}
          <div className="flex items-center gap-1">
            <Button
              variant="outline"
              size="sm"
              className={`shrink-0 gap-1 font-bold ${expanded ? "h-12 px-3 text-xs" : "h-7 px-1.5 text-[9px]"}`}
              onClick={() => setSeqOpen(true)}
              disabled={pendingSteps.length === 0 || needsName}
              title={needsName ? "Peça o nome do lead primeiro" : pendingSteps.length === 0 ? "Tudo enviado" : `Disparar ${pendingSteps.length} passos pendentes`}
            >
              <Zap className={`${expanded ? "w-4 h-4" : "w-2.5 h-2.5"}`} /> Enviar tudo ({pendingSteps.length})
            </Button>
            <Button
              size="lg"
              className={`flex-1 font-bold gap-1 ${expanded ? "h-12 text-base" : "h-7 text-[10px]"} ${
                canSubmit
                  ? "bg-gradient-to-r from-emerald-500 to-emerald-600 text-white hover:opacity-95 animate-exec-energy shadow-lg shadow-emerald-500/30"
                  : "bg-muted text-muted-foreground opacity-60 cursor-not-allowed hover:bg-muted"
              }`}
              onClick={handleSubmit}
              disabled={submitting || !canSubmit}
              title={submitTooltip}
            >
              {submitting ? <Loader2 className={`${expanded ? "w-5 h-5" : "w-3 h-3"} animate-spin`} /> : <Trophy className={`${expanded ? "w-5 h-5" : "w-3 h-3"}`} />}
              {canSubmit ? "CADASTRAR" : `${filledCount}/${totalFields}${!billConfirmed ? " ·📄" : ""}${!docConfirmed ? " ·🪪" : ""}`}
            </Button>
            <Button variant="ghost" size="sm" className={`shrink-0 text-muted-foreground ${expanded ? "h-12 text-xs px-2" : "h-7 px-1.5 text-[9px]"}`} onClick={disableCapture} title="Sair do modo captação">
              Sair
            </Button>
          </div>
        </footer>
      </SheetContent>

      <SendSequenceDialog
        open={seqOpen}
        onOpenChange={setSeqOpen}
        consultantId={consultantId}
        customerId={customerId}
        customerName={customerName || phoneNumber}
        steps={pendingSteps}
        variant={(((customer as any)?.flow_variant || "A").toUpperCase()) as "A" | "B" | "C" | "D" | "E"}
        onStepSent={(key) => setSentSteps((s) => new Set(s).add(key))}
        onAskName={handleAskName}
      />
      <FinalizeNoticeDialog
        open={askNotice}
        onOpenChange={setAskNotice}
        onWithoutNotice={() => void runFinalize(false)}
        onWithNotice={() => void runFinalize(true)}
      />
    </Sheet>
  );
}

function FinalizeNoticeDialog({
  open,
  onOpenChange,
  onWithoutNotice,
  onWithNotice,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onWithoutNotice: () => void;
  onWithNotice: () => void;
}) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Avisar o cliente no WhatsApp?</AlertDialogTitle>
          <AlertDialogDescription>
            O bot está desligado para este lead. Você pode cadastrar no portal sem enviar nada ao cliente, ou enviar a mensagem agora.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter className="gap-2">
          <AlertDialogCancel>Cancelar</AlertDialogCancel>
          <AlertDialogAction
            onClick={() => {
              onOpenChange(false);
              onWithoutNotice();
            }}
            className="bg-secondary text-secondary-foreground hover:bg-secondary/80"
          >
            Cadastrar sem avisar
          </AlertDialogAction>
          <AlertDialogAction
            onClick={() => {
              onOpenChange(false);
              onWithNotice();
            }}
          >
            Enviar mensagem e cadastrar
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/** Embedded ficha (no extra header/footer — Sheet provides them) */
function FichaWrap({ customerId }: { customerId: string }) {
  return (
    <div className="h-full w-full overflow-hidden">
      <CaptureLeadCard customerId={customerId} embedded />
    </div>
  );
}

