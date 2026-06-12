/**
 * useCopyLogic — lógica do Step 3 (texto + mensagem WhatsApp).
 * Extraído do wizard legado: geração de copy via IA, sincronização da
 * primeira mensagem com a distribuidora, checagem de frase duplicada e
 * variação com IA (frase única por campanha — CTWA).
 */
import { useEffect, useCallback } from "react";
import { useToast } from "@/hooks/use-toast";
import { generateCopy, checkInitialMessage, varyInitialMessage } from "@/services/facebookAds";
import { buildDefaultInitialMessage } from "../wizardHelpers";
import type { WizardState, WizardDerived } from "./useWizardState";

interface Deps {
  open: boolean;
  state: WizardState;
  derived: WizardDerived;
  patch: (p: Partial<WizardState>) => void;
}

export function useCopyLogic({ open, state, derived, patch }: Deps) {
  const { toast } = useToast();
  const { distribuidoraPrimary, distribuidoraJoined } = derived;

  // Mantém a primeira mensagem sincronizada com a distribuidora enquanto o
  // usuário não editar manualmente.
  useEffect(() => {
    if (state.initialMessageTouched) return;
    patch({ initialMessage: buildDefaultInitialMessage(distribuidoraPrimary) });
  }, [distribuidoraPrimary, state.initialMessageTouched]); // eslint-disable-line react-hooks/exhaustive-deps

  // Checa (debounce) frase duplicada. Só no Step 3.
  useEffect(() => {
    if (!open || state.step !== 3) { patch({ initialMsgDuplicate: false }); return; }
    const msg = state.initialMessage.trim();
    if (msg.length < 5) { patch({ initialMsgDuplicate: false }); return; }
    let cancelled = false;
    const t = setTimeout(async () => {
      patch({ initialMsgChecking: true });
      try {
        const r = await checkInitialMessage(msg, distribuidoraPrimary);
        if (!cancelled) patch({ initialMsgDuplicate: !!r.duplicate });
      } catch { if (!cancelled) patch({ initialMsgDuplicate: false }); }
      finally { if (!cancelled) patch({ initialMsgChecking: false }); }
    }, 600);
    return () => { cancelled = true; clearTimeout(t); };
  }, [open, state.step, state.initialMessage, distribuidoraPrimary]); // eslint-disable-line react-hooks/exhaustive-deps

  const generateCopyForCities = useCallback(async () => {
    patch({ copyLoading: true });
    try {
      const cityList = distribuidoraJoined
        ? [`clientes de ${distribuidoraJoined}`, ...state.cities.map((x) => x.name).slice(0, 3)]
        : state.cities.map((x) => x.name);
      const c = await generateCopy(cityList);
      patch({
        copy: c,
        headline: c.headlines[0] || "",
        primaryText: c.primary_texts[0] || "",
        description: c.description || "",
      });
    } catch (e: any) {
      toast({ title: "Erro ao gerar copy", description: e.message, variant: "destructive" });
    } finally { patch({ copyLoading: false }); }
  }, [distribuidoraJoined, state.cities, patch, toast]);

  const handleVaryInitialMessage = useCallback(async () => {
    patch({ initialMsgVarying: true });
    try {
      const r = await varyInitialMessage(state.initialMessage.trim(), distribuidoraPrimary);
      patch({ initialMessage: r.message, initialMessageTouched: true, initialMsgDuplicate: !!r.duplicate });
      toast({ title: "Frase variada com IA", description: "Mantivemos o foco e deixamos única para medir esta campanha." });
    } catch (e: any) {
      toast({ title: "Não consegui variar agora", description: e?.message || "Tente de novo.", variant: "destructive" });
    } finally { patch({ initialMsgVarying: false }); }
  }, [state.initialMessage, distribuidoraPrimary, patch, toast]);

  return { generateCopyForCities, handleVaryInitialMessage };
}
