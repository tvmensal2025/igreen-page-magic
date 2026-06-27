/**
 * useRodizioLogic — lógica do bloco de rodízio (Step 4 / StepBudget).
 * Concentra TODA a regra do rodízio para que os componentes (RodizioBlock e
 * RodizioInlineForm) apenas renderizem:
 *   - carrega os `referral_partners` do dono (participantes disponíveis);
 *   - adiciona/remove participante da lista ordenada, impedindo duplicado;
 *   - valida o form inline (CONSULTOR exige código iGreen; PARCEIRO exige cli;
 *     ambos exigem nome e telefone de aviso);
 *   - cria o participante e já o adiciona à lista ordenada;
 *   - valida o mínimo de 2 participantes quando o rodízio está ligado.
 */
import { useState, useEffect, useCallback, useMemo } from "react";
import { useToast } from "@/hooks/use-toast";
import {
  listActiveReferralPartners,
  createReferralPartner,
} from "@/services/referralPartners";
import type {
  WizardState,
  RodizioPartnerDraft,
  RodizioInlineForm,
} from "./useWizardState";

interface Deps {
  open: boolean;
  state: WizardState;
  patch: (p: Partial<WizardState>) => void;
  patchFn: (fn: (prev: WizardState) => Partial<WizardState>) => void;
}

/** Form inline vazio para um dado tipo de participante. */
function emptyInlineForm(tipo: RodizioInlineForm["tipo"]): RodizioInlineForm {
  return {
    tipo,
    nome: "",
    notification_phone: "",
    partner_igreen_id: "",
    cli: "",
  };
}

/**
 * Valida os campos do form inline. Devolve a lista de mensagens de erro
 * (vazia quando o form está válido), conforme o tipo do participante.
 */
export function validateInlineForm(form: RodizioInlineForm): string[] {
  const erros: string[] = [];
  if (!form.nome.trim()) erros.push("Informe o nome do participante.");
  if (!form.notification_phone.trim()) {
    erros.push("Informe o telefone de aviso.");
  }
  if (form.tipo === "consultor" && !form.partner_igreen_id.trim()) {
    erros.push("O código iGreen é obrigatório para o tipo CONSULTOR.");
  }
  if (form.tipo === "parceiro" && !form.cli.trim()) {
    erros.push("O cli é obrigatório para o tipo PARCEIRO/INDICADOR.");
  }
  return erros;
}

export function useRodizioLogic({ open, state, patch, patchFn }: Deps) {
  const { toast } = useToast();
  // Participantes existentes do dono, para o multi-select (combobox).
  const [availablePartners, setAvailablePartners] = useState<RodizioPartnerDraft[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [creating, setCreating] = useState(false);

  // Carrega os referral_partners do dono na primeira vez que o rodízio liga.
  const loadPartners = useCallback(async () => {
    patch({ rodizioPartnersLoading: true });
    try {
      const partners = await listActiveReferralPartners();
      setAvailablePartners(partners);
      setLoaded(true);
    } catch (e: any) {
      toast({
        title: "Erro ao carregar participantes",
        description: e?.message || "Tente novamente.",
        variant: "destructive",
      });
    } finally {
      patch({ rodizioPartnersLoading: false });
    }
  }, [patch, toast]);

  useEffect(() => {
    if (!open || !state.rodizioEnabled || loaded) return;
    void loadPartners();
  }, [open, state.rodizioEnabled, loaded, loadPartners]);

  // Reseta o cache de carregamento ao fechar o wizard.
  useEffect(() => {
    if (!open) {
      setLoaded(false);
      setAvailablePartners([]);
    }
  }, [open]);

  /** Liga/desliga o rodízio; ao desligar, descarta a seleção e o form inline. */
  const setRodizioEnabled = useCallback(
    (enabled: boolean) => {
      if (enabled) {
        patch({ rodizioEnabled: true });
      } else {
        patch({
          rodizioEnabled: false,
          rodizioPartners: [],
          rodizioInlineForm: null,
        });
      }
    },
    [patch],
  );

  /** Adiciona um participante à lista ordenada, impedindo duplicado. */
  const addPartner = useCallback(
    (partner: RodizioPartnerDraft) => {
      let added = false;
      patchFn((prev) => {
        if (prev.rodizioPartners.some((p) => p.id === partner.id)) {
          return {};
        }
        added = true;
        return { rodizioPartners: [...prev.rodizioPartners, partner] };
      });
      if (!added) {
        toast({
          title: "Participante já adicionado",
          description: `${partner.nome} já está na lista do rodízio.`,
        });
      }
    },
    [patchFn, toast],
  );

  /** Remove um participante da lista ordenada pelo id. */
  const removePartner = useCallback(
    (id: string) => {
      patchFn((prev) => ({
        rodizioPartners: prev.rodizioPartners.filter((p) => p.id !== id),
      }));
    },
    [patchFn],
  );

  /** Abre o form inline para criar um participante de um dado tipo. */
  const openInlineForm = useCallback(
    (tipo: RodizioInlineForm["tipo"]) => {
      patch({ rodizioInlineForm: emptyInlineForm(tipo) });
    },
    [patch],
  );

  /** Fecha o form inline sem salvar. */
  const closeInlineForm = useCallback(() => {
    patch({ rodizioInlineForm: null });
  }, [patch]);

  /** Atualiza campos do form inline aberto. */
  const updateInlineForm = useCallback(
    (partial: Partial<RodizioInlineForm>) => {
      patchFn((prev) =>
        prev.rodizioInlineForm
          ? { rodizioInlineForm: { ...prev.rodizioInlineForm, ...partial } }
          : {},
      );
    },
    [patchFn],
  );

  /** Valida e cria o participante do form inline, adicionando-o à lista. */
  const submitInlineForm = useCallback(async () => {
    const form = state.rodizioInlineForm;
    if (!form) return;
    const erros = validateInlineForm(form);
    if (erros.length > 0) {
      toast({
        title: "Confira os campos",
        description: erros.join(" "),
        variant: "destructive",
      });
      return;
    }
    setCreating(true);
    try {
      const novo = await createReferralPartner({
        tipo: form.tipo,
        nome: form.nome,
        notification_phone: form.notification_phone,
        partner_igreen_id: form.partner_igreen_id,
        cli: form.cli,
      });
      // Disponibiliza no multi-select e adiciona à lista ordenada.
      setAvailablePartners((prev) => [novo, ...prev]);
      patchFn((prev) => ({
        rodizioPartners: prev.rodizioPartners.some((p) => p.id === novo.id)
          ? prev.rodizioPartners
          : [...prev.rodizioPartners, novo],
        rodizioInlineForm: null,
      }));
      toast({
        title: "Participante criado",
        description: `${novo.nome} entrou no rodízio.`,
      });
    } catch (e: any) {
      toast({
        title: "Não consegui criar o participante",
        description: e?.message || "Tente novamente.",
        variant: "destructive",
      });
    } finally {
      setCreating(false);
    }
  }, [state.rodizioInlineForm, patchFn, toast]);

  // Mensagem de erro do mínimo de 2 participantes (Requisito 5.2).
  const minParticipantsError = useMemo<string | null>(() => {
    if (!state.rodizioEnabled) return null;
    if (state.rodizioPartners.length < 2) {
      return "O rodízio exige pelo menos 2 participantes.";
    }
    return null;
  }, [state.rodizioEnabled, state.rodizioPartners.length]);

  return {
    availablePartners,
    creating,
    minParticipantsError,
    reloadPartners: loadPartners,
    setRodizioEnabled,
    addPartner,
    removePartner,
    openInlineForm,
    closeInlineForm,
    updateInlineForm,
    submitInlineForm,
  };
}
