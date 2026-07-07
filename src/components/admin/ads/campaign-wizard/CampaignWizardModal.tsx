/**
 * CampaignWizardModal — Container do wizard "Criar Campanha" (Modelo A).
 * Grid 3 colunas (Sidebar + Step + Preview) no desktop; Drawer (vaul) no mobile.
 * Transição entre steps com AnimatePresence (slide horizontal).
 *
 * Toda a lógica de negócio mora nos hooks (useWizardState + use*Logic + usePublish),
 * reaproveitando 100% do comportamento do wizard legado.
 */
import { useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import confetti from "canvas-confetti";
import { Sparkles, Loader2, Save, X } from "lucide-react";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Drawer, DrawerContent, DrawerTitle, DrawerDescription } from "@/components/ui/drawer";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { useIsMobile } from "@/hooks/use-mobile";
import { useFacebookConnection } from "@/hooks/useFacebookConnection";
import { useUserRole } from "@/hooks/useUserRole";
import { useConsultantPhone } from "@/hooks/useConsultantPhone";
import { validateAccount, getWalletBalance } from "@/services/facebookAds";
import { useEffect, useState } from "react";
import { SaveTemplateDialog } from "../SaveTemplateDialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";

import { useWizardState, type WizardStep } from "./hooks/useWizardState";
import { useRegionLogic } from "./hooks/useRegionLogic";
import { useCreativeLogic } from "./hooks/useCreativeLogic";
import { useCopyLogic } from "./hooks/useCopyLogic";
import { usePublish } from "./hooks/usePublish";
import { WizardSidebar } from "./WizardSidebar";
import { WizardPreview } from "./WizardPreview";
import { WizardFooter } from "./WizardFooter";
import { StepRegion } from "./steps/StepRegion";
import { StepCreative } from "./steps/StepCreative";
import { StepCopy } from "./steps/StepCopy";
import { StepBudget } from "./steps/StepBudget";
import { StepReview } from "./steps/StepReview";

interface Props {
  open: boolean;
  onClose: () => void;
  consultantId: string;
  onCreated?: () => void;
}

export function CampaignWizardModal({ open, onClose, consultantId, onCreated }: Props) {
  const { toast } = useToast();
  const isMobile = useIsMobile();
  const { connection } = useFacebookConnection(consultantId);
  const { isSuperAdmin } = useUserRole(consultantId);
  const { phone: consultantPhone } = useConsultantPhone(consultantId);
  const [walletBalance, setWalletBalance] = useState<number | null>(null);

  const { state, patch, patchFn, derived, LS_KEY } = useWizardState(open, consultantId);

  const region = useRegionLogic({ open, state, patch, patchFn });
  const creative = useCreativeLogic({ consultantId, state, patch, patchFn });
  const copyLogic = useCopyLogic({ open, state, derived, patch });

  // Confetti ao publicar com sucesso (antes de fechar o modal).
  const handleCreated = useCallback(() => {
    confetti({ particleCount: 140, spread: 75, origin: { y: 0.7 } });
    onCreated?.();
  }, [onCreated]);

  const publish = usePublish({
    consultantId, consultantPhone, isSuperAdmin, state, derived, patch, LS_KEY,
    onCreated: handleCreated, onClose,
  });

  // Validação de conta + saldo da carteira ao abrir.
  useEffect(() => {
    if (!open) return;
    setWalletBalance(null);
    validateAccount().then((r) => patch({ issues: r.issues })).catch((e) => patch({ issues: [e.message] }));
    getWalletBalance(consultantId).then((w) => setWalletBalance(w.balance_cents)).catch(() => setWalletBalance(0));
  }, [open, consultantId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Steps concluídos (para os checks na sidebar).
  const completedSteps = new Set<number>();
  for (let s = 1; s < state.step; s++) completedSteps.add(s);

  const goTo = (step: WizardStep) => patch({ step, direction: step > state.step ? 1 : -1 });
  const goBack = () => { if (state.step > 1) goTo((state.step - 1) as WizardStep); else onClose(); };

  async function goNext() {
    const { step } = state;
    if (step === 1) {
      if (state.geoMode === "cities" && state.cities.length === 0) return toast({ title: "Selecione pelo menos 1 cidade", variant: "destructive" });
      if (state.geoMode === "radius" && state.radiusPoints.length === 0) return toast({ title: "Adicione pelo menos 1 endereço", variant: "destructive" });
      goTo(2);
    } else if (step === 2) {
      if (state.creativeMode === "video") {
        if (!state.videoFile && !state.videoUrl) return toast({ title: "Envie um vídeo (.mp4 vertical)", variant: "destructive" });
      } else if (derived.totalFiles + state.pickedLibrary.length < 1) {
        return toast({ title: "Adicione pelo menos 1 foto válida", variant: "destructive" });
      }
      goTo(3);
      if (!state.copy) copyLogic.generateCopyForCities();
    } else if (step === 3) {
      if (!state.headline || !state.primaryText) return toast({ title: "Preencha título e texto", variant: "destructive" });
      if (state.initialMessage.trim().length < 5) return toast({ title: "Escreva a primeira mensagem do WhatsApp", variant: "destructive" });
      if (state.initialMsgDuplicate) return toast({ title: "Primeira mensagem repetida", description: "Toque em 'Variar com IA' para deixá-la única antes de avançar.", variant: "destructive" });
      if (state.quality && !state.quality.canPublish) {
        const blockHit = state.quality.copy.hits.find((h) => h.severity === "block");
        return toast({ title: "Termo proibido pela Meta", description: blockHit?.message || "Remova os itens em vermelho.", variant: "destructive" });
      }
      if (state.quality && !state.quality.recommendedPublish) return patch({ lowScoreConfirm: true });
      goTo(4);
    } else if (step === 4) {
      goTo(5);
    } else if (step === 5) {
      // Pré-checagem CTWA: super admin pula; demais precisam estar prontos.
      // Em vez de deixar o botão "morto", explicamos o que falta.
      if (!isSuperAdmin && !state.ctwaReady) {
        return toast({
          title: "Falta concluir a pré-checagem",
          description: "Revise os itens em amarelo/vermelho no topo (bot, Facebook, WhatsApp Business) e toque em 'Reverificar' antes de publicar.",
          variant: "destructive",
        });
      }
      await publish.submit();
    }
  }

  // Bloqueia o botão final apenas enquanto a pré-checagem está rodando.
  // (A exigência do CTWA pronto é validada no goNext, com aviso claro.)
  const canAdvance = !state.copyLoading
    && !(state.step === 5 && state.preflightLoading);

  const renderStep = () => {
    switch (state.step) {
      case 1: return <StepRegion state={state} patch={patch} region={region} />;
      case 2: return <StepCreative state={state} patch={patch} patchFn={patchFn} creative={creative} consultantId={consultantId} />;
      case 3: return <StepCopy state={state} derived={derived} patch={patch} copyLogic={copyLogic} />;
      case 4: return <StepBudget open={open} state={state} patch={patch} patchFn={patchFn} />;
      case 5: return (
        <StepReview state={state} derived={derived} patch={patch} publish={publish}
          consultantId={consultantId} consultantPhone={consultantPhone}
          pageName={connection?.page_name || "iGreen Energy"} />
      );
    }
  };

  const body = (
    <div className="flex flex-col h-full min-h-0">
      {/* Header */}
      <header className="shrink-0 flex items-center justify-between px-5 py-3 border-b border-[hsl(var(--ads-border))]">
        <div className="flex items-center gap-2 font-bold">
          <Sparkles className="w-5 h-5 text-primary" /> Nova campanha
        </div>
        <div className="flex items-center gap-2">
          {state.step >= 3 && (
            <Button type="button" variant="outline" size="sm" className="gap-1.5"
              onClick={() => patch({ saveTplOpen: true })}
              disabled={state.submitting || state.savingTemplate || !state.headline.trim() || !state.primaryText.trim()}
              title={!state.headline.trim() || !state.primaryText.trim() ? "Preencha título e texto antes" : "Salvar esta campanha como modelo reutilizável"}>
              {state.savingTemplate ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} Salvar template
            </Button>
          )}
          <button onClick={() => !state.submitting && onClose()} aria-label="Fechar" title="Fechar" className="text-[hsl(var(--ads-muted))] hover:text-foreground">
            <X className="w-5 h-5" />
          </button>
        </div>
      </header>

      {/* Avisos de conta */}
      {derived.visibleIssues.length > 0 && (
        <div className="shrink-0 text-xs border-b border-warning/30 bg-warning/10 text-warning px-5 py-2">⚠️ {derived.visibleIssues.join(" ")}</div>
      )}

      {/* Grid 3 colunas */}
      <div className="flex-1 min-h-0 flex">
        <WizardSidebar currentStep={state.step} onStepClick={goTo} completedSteps={completedSteps} walletBalance={walletBalance} />

        <main className="flex-1 min-w-0 overflow-y-auto p-5">
          {state.issues === null ? (
            <div className="flex justify-center py-16"><Loader2 className="w-6 h-6 animate-spin text-[hsl(var(--ads-muted))]" /></div>
          ) : (
            <AnimatePresence mode="wait" initial={false} custom={state.direction}>
              <motion.div
                key={state.step}
                custom={state.direction}
                initial={{ opacity: 0, x: state.direction > 0 ? 40 : -40 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: state.direction > 0 ? -40 : 40 }}
                transition={{ duration: 0.22, ease: "easeOut" }}
              >
                {renderStep()}
              </motion.div>
            </AnimatePresence>
          )}
        </main>

        <WizardPreview
          step={state.step}
          state={state}
          pageName={connection?.page_name || "iGreen Energy"}
          whatsappNumber={consultantPhone || ""}
        />
      </div>

      <WizardFooter step={state.step} onBack={goBack} onNext={goNext} submitting={state.submitting} canAdvance={canAdvance} />
    </div>
  );

  const auxDialogs = (
    <>
      <SaveTemplateDialog
        open={state.saveTplOpen}
        onClose={() => patch({ saveTplOpen: false })}
        defaultTitle={`${derived.distribuidoraPrimary || "Multi"} — ${state.headline.slice(0, 40)}`}
        saving={state.savingTemplate}
        isSuperAdmin={isSuperAdmin}
        onConfirm={(meta) => publish.handleSaveAsTemplate(meta)}
      />
      <AlertDialog open={state.lowScoreConfirm} onOpenChange={(o) => patch({ lowScoreConfirm: o })}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Score {state.quality?.score ?? 0}/100 — abaixo do ideal</AlertDialogTitle>
            <AlertDialogDescription>
              Anúncios com score abaixo de 70 tendem a ter CPL mais alto e menos alcance. Você pode voltar e ajustar, ou publicar mesmo assim.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Voltar a ajustar</AlertDialogCancel>
            <AlertDialogAction onClick={() => { patch({ lowScoreConfirm: false }); goTo(4); }}>Publicar mesmo assim</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );

  if (isMobile) {
    return (
      <>
        <Drawer open={open} onOpenChange={(o) => !o && !state.submitting && onClose()}>
          <DrawerContent className="ads-wizard-scope h-[96vh] p-0 bg-[hsl(var(--ads-surface))] text-[hsl(var(--ads-text))]">
            <DrawerTitle className="sr-only">Criar nova campanha de anúncio</DrawerTitle>
            <DrawerDescription className="sr-only">Assistente em 5 passos para criar e publicar sua campanha.</DrawerDescription>
            {body}
          </DrawerContent>
        </Drawer>
        {auxDialogs}
      </>
    );
  }

  return (
    <>
      <Dialog open={open} onOpenChange={(o) => !o && !state.submitting && onClose()}>
        <DialogContent className="ads-wizard-scope max-w-[1200px] w-[95vw] h-[90vh] p-0 gap-0 overflow-hidden bg-[hsl(var(--ads-surface))] text-[hsl(var(--ads-text))] shadow-2xl" hideCloseButton>
          <DialogTitle className="sr-only">Criar nova campanha de anúncio</DialogTitle>
          <DialogDescription className="sr-only">Assistente em 5 passos para criar e publicar sua campanha no Facebook e Instagram.</DialogDescription>
          {body}
        </DialogContent>
      </Dialog>
      {auxDialogs}
    </>
  );
}
