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
import { supabase } from "@/integrations/supabase/client";
import {
  listActiveReferralPartners,
  createReferralPartner,
  normalizeBrPhone,
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

/** Campo do form inline que pode conter erro de validação. */
export type RodizioFieldKey =
  | "nome"
  | "notification_phone"
  | "partner_igreen_id"
  | "cli";

/** Erro de validação com o campo alvo — permite destacar o input certo. */
export interface RodizioFieldError {
  field: RodizioFieldKey;
  message: string;
}

/**
 * Valida os campos do form inline. Devolve erros com o `field` alvo, para que
 * o componente destaque o input correto (sem depender de substring matching).
 */
export function validateInlineForm(form: RodizioInlineForm): RodizioFieldError[] {
  const erros: RodizioFieldError[] = [];
  if (!form.nome.trim()) {
    erros.push({ field: "nome", message: "Digite o nome do participante." });
  }
  const phone = normalizeBrPhone(form.notification_phone);
  if (!phone) {
    erros.push({
      field: "notification_phone",
      message: "📱 Ex.: 11 99999-8888 (com DDD).",
    });
  }
  if (form.tipo === "consultor" && !form.partner_igreen_id.trim()) {
    erros.push({
      field: "partner_igreen_id",
      message: "🆔 O código iGreen aparece no painel do consultor.",
    });
  }
  if (form.tipo === "parceiro" && !form.cli.trim()) {
    erros.push({
      field: "cli",
      message: "🔢 Código de indicação (o iGreen chama de `cli`). Peça pro parceiro.",
    });
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
          title: "♻️ Já está no rodízio",
          description: `${partner.nome} já está na lista.`,
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
        title: "⚠️ Confira os campos abaixo",
        description: "Corrija os itens destacados em vermelho.",
        variant: "destructive",
      });
      return;
    }

    // Duplicidade só bloqueia dentro do rodízio DESTA campanha.
    // Se o participante já existe entre os `availablePartners` (foi cadastrado
    // antes, em outra campanha), reusamos em vez de bloquear — o mesmo parceiro
    // pode participar de várias campanhas.
    const normalizedPhone = normalizeBrPhone(form.notification_phone);
    const igreenId = form.partner_igreen_id.trim();
    const cli = form.cli.trim();

    const matchesIdentity = (p: RodizioPartnerDraft) => {
      if (normalizedPhone && normalizeBrPhone(p.notification_phone) === normalizedPhone) return true;
      if (form.tipo === "consultor" && igreenId && (p.partner_igreen_id ?? "").trim() === igreenId) return true;
      if (form.tipo === "parceiro" && cli && (p.cli ?? "").trim() === cli) return true;
      return false;
    };

    const dupInCurrent = state.rodizioPartners.find(matchesIdentity);
    if (dupInCurrent) {
      toast({
        title: "♻️ Já está no rodízio",
        description: `${dupInCurrent.nome} já está na lista desta campanha.`,
      });
      return;
    }

    const dupInAvailable = availablePartners.find(matchesIdentity);
    if (dupInAvailable) {
      patchFn((prev) => ({
        rodizioPartners: prev.rodizioPartners.some((p) => p.id === dupInAvailable.id)
          ? prev.rodizioPartners
          : [...prev.rodizioPartners, dupInAvailable],
        rodizioInlineForm: null,
      }));
      toast({
        title: "♻️ Participante reaproveitado",
        description: `${dupInAvailable.nome} já estava cadastrado — adicionado ao rodízio desta campanha.`,
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
        title: "✅ Participante adicionado",
        description: `${novo.nome} entrou no rodízio. Vai receber os avisos no WhatsApp ${novo.notification_phone ?? ""}.`,
      });
    } catch (e: any) {
      toast({
        title: "❌ Não consegui salvar",
        description: e?.message || "Tente de novo em alguns segundos.",
        variant: "destructive",
      });
    } finally {
      setCreating(false);
    }
  }, [state.rodizioInlineForm, state.rodizioPartners, availablePartners, patchFn, toast]);

  /**
   * Adiciona o próprio dono da conta (consultor logado) ao rodízio, sem
   * precisar redigitar nome/telefone/código. Se ele já foi cadastrado antes
   * (existe em `availablePartners`), reusa; caso contrário cria um
   * `referral_partners` tipo CONSULTOR com os dados do perfil.
   */
  const addMyself = useCallback(async () => {
    setCreating(true);
    try {
      const { data: userRes, error: userErr } = await supabase.auth.getUser();
      if (userErr || !userRes?.user?.id) {
        throw new Error("Sessão inválida. Faça login novamente.");
      }
      const uid = userRes.user.id;
      const { data: me, error: meErr } = await supabase
        .from("consultants")
        .select("id, name, phone, igreen_id")
        .eq("id", uid)
        .maybeSingle();
      if (meErr) throw meErr;
      if (!me) throw new Error("Perfil do consultor não encontrado.");
      const nome = (me.name || "").trim();
      const phone = normalizeBrPhone(me.phone);
      const igreenId = (me.igreen_id || "").trim();
      if (!nome || !phone || !igreenId) {
        toast({
          title: "Complete seu perfil",
          description: "Cadastre nome, WhatsApp e código iGreen em Meus Dados antes de se adicionar ao rodízio.",
          variant: "destructive",
        });
        return;
      }

      const alreadyInCurrent = state.rodizioPartners.find(
        (p) => (p.partner_igreen_id ?? "").trim() === igreenId
          || normalizeBrPhone(p.notification_phone) === phone,
      );
      if (alreadyInCurrent) {
        toast({ title: "♻️ Você já está no rodízio", description: `${alreadyInCurrent.nome} já está na lista.` });
        return;
      }

      const existing = availablePartners.find(
        (p) => (p.partner_igreen_id ?? "").trim() === igreenId
          || normalizeBrPhone(p.notification_phone) === phone,
      );
      if (existing) {
        patchFn((prev) => ({
          rodizioPartners: [...prev.rodizioPartners, existing],
        }));
        toast({ title: "✅ Você entrou no rodízio", description: `${existing.nome} adicionado.` });
        return;
      }

      const novo = await createReferralPartner({
        tipo: "consultor",
        nome,
        notification_phone: phone,
        partner_igreen_id: igreenId,
      });
      setAvailablePartners((prev) => [novo, ...prev]);
      patchFn((prev) => ({
        rodizioPartners: [...prev.rodizioPartners, novo],
      }));
      toast({ title: "✅ Você entrou no rodízio", description: `${novo.nome} adicionado.` });
    } catch (e: any) {
      toast({
        title: "❌ Não consegui te adicionar",
        description: e?.message || "Tente novamente.",
        variant: "destructive",
      });
    } finally {
      setCreating(false);
    }
  }, [availablePartners, state.rodizioPartners, patchFn, toast]);

  // Mensagem de erro do mínimo de 2 participantes (Requisito 5.2).
  const minParticipantsError = useMemo<string | null>(() => {
    if (!state.rodizioEnabled) return null;
    const faltam = 2 - state.rodizioPartners.length;
    if (faltam > 0) {
      return `⚠️ Faltam participantes — o rodízio precisa de pelo menos 2 pessoas. Adicione mais ${faltam} ou desligue o rodízio.`;
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
    addMyself,
    removePartner,
    openInlineForm,
    closeInlineForm,
    updateInlineForm,
    submitInlineForm,
  };
}
