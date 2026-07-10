/**
 * useCopyLogic — lógica do Step 3 (texto + mensagem WhatsApp).
 *
 * MUDANÇA importante (jul/2026):
 * - `generateCopyForCities` NÃO chama mais a IA por padrão. Passa a montar o
 *   pack a partir do catálogo local (`src/data/copyCatalog.ts`) — 200 copies
 *   curadas, resposta em <5ms, sem depender do edge `ad-creative-builder`
 *   (que estava dando erro e travando o wizard).
 * - `reshuffleCopy()` re-sorteia 5 novas sugestões sem chamar rede.
 * - `adaptCopyWithAI()` continua chamando o edge como REFINAMENTO opcional; se
 *   falhar, mostra toast e mantém o pack local (não trava o fluxo).
 * - `handleVaryInitialMessage` (a mensagem CTWA do WhatsApp) segue igual.
 */
import { useEffect, useCallback, useRef } from "react";
import { useToast } from "@/hooks/use-toast";
import { generateCopy, checkInitialMessage, varyInitialMessage } from "@/services/facebookAds";
import { sampleCopyPack } from "@/data/copyCatalog";
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
  const seedRef = useRef<number>(Date.now());

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

  /** Monta um pack local (sem IA). Instantâneo. */
  const buildLocalPack = useCallback((seed?: number) => {
    const cidade = state.cities[0]?.name || null;
    const pack = sampleCopyPack(
      { distribuidora: distribuidoraPrimary || null, cidade },
      seed ?? seedRef.current,
    );
    // Formato compatível com CopyPack legado: primeiras strings + variations.
    return {
      headlines: pack.headlines.map((h) => h.text),
      primary_texts: pack.primary_texts.map((t) => t.text),
      description: pack.description,
      variations: {
        headlines: pack.headlines,
        primary_texts: pack.primary_texts,
      },
    };
  }, [distribuidoraPrimary, state.cities]);

  /** Popula o Step 3 com sugestões locais (substitui o antigo "gerar com IA"). */
  const generateCopyForCities = useCallback(() => {
    const c = buildLocalPack();
    patch({
      copy: c as any,
      headline: state.headline || c.headlines[0] || "",
      primaryText: state.primaryText || c.primary_texts[0] || "",
      description: state.description || c.description || "",
      copyLoading: false,
    });
  }, [buildLocalPack, patch, state.headline, state.primaryText, state.description]);

  /** Re-sorteia 5 novas sugestões (sem tocar em rede). */
  const reshuffleCopy = useCallback(() => {
    seedRef.current = Date.now();
    const c = buildLocalPack(seedRef.current);
    patch({
      copy: c as any,
      headline: c.headlines[0] || "",
      primaryText: c.primary_texts[0] || "",
      description: c.description || "",
    });
    toast({ title: "🔄 Novas sugestões", description: "Sorteamos 6 novos títulos e 3 textos." });
  }, [buildLocalPack, patch, toast]);

  /** Refinamento opcional via IA (Gemini). Se falhar, mantém o pack local. */
  const adaptCopyWithAI = useCallback(async () => {
    patch({ copyLoading: true });
    try {
      const cityList = distribuidoraJoined
        ? [`clientes de ${distribuidoraJoined}`, ...state.cities.map((x) => x.name).slice(0, 3)]
        : state.cities.map((x) => x.name);
      const c = await generateCopy(cityList);
      if (c && (c.headlines?.length || 0) > 0) {
        patch({
          copy: c,
          headline: c.headlines[0] || state.headline,
          primaryText: c.primary_texts[0] || state.primaryText,
          description: c.description || state.description,
        });
        toast({ title: "✨ Adaptado pela IA", description: "Copies personalizadas para sua região." });
      } else {
        throw new Error("resposta vazia");
      }
    } catch (e: any) {
      toast({
        title: "IA indisponível agora",
        description: "Mantive as sugestões do catálogo — pode publicar sem problema.",
        variant: "destructive",
      });
    } finally { patch({ copyLoading: false }); }
  }, [distribuidoraJoined, state.cities, state.headline, state.primaryText, state.description, patch, toast]);


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
