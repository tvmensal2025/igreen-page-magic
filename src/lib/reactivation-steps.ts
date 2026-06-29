/**
 * Catálogo canônico das etapas do fluxo que têm frase de reaquecimento
 * pronta. Espelha `KNOWN_REACTIVATION_STEPS` da Edge Function
 * `_shared/conversion/phrase-catalog.ts` (frontend não pode importar de
 * supabase/functions diretamente, então duplicamos a lista aqui).
 *
 * Mantém o painel admin mostrando TODAS as etapas mesmo quando nenhum lead
 * está parado naquela etapa no momento.
 */

export interface ReactivationStepSuggestion {
  step: string;
  label: string;
  suggested: string;
}

export const KNOWN_REACTIVATION_STEPS: ReactivationStepSuggestion[] = [
  {
    step: "boas_vindas_botoes",
    label: "Boas-vindas com botões",
    suggested: "Oi! Vi que você começou a conversa mas não escolheu uma opção. Quer continuar? Só responder qualquer coisa que eu sigo daqui 💚",
  },
  {
    step: "como_funciona",
    label: "Como funciona",
    suggested: "Ficou alguma dúvida sobre como o desconto funciona? Posso te explicar em poucas palavras e já partir pra simulação 🙂",
  },
  {
    step: "completa_ou_rapida",
    label: "Completa ou Rápida",
    suggested: "Pra eu continuar, me diz: você prefere o cadastro Rápido (só com o valor da conta) ou o Completo (com a foto da conta para já calcular tudo)?",
  },
  {
    step: "aguardando_valor_conta",
    label: "Esperando o valor da conta",
    suggested: "Pra eu te mostrar o desconto exato, falta só o valor médio da sua conta de luz. Quanto vem por mês, mais ou menos?",
  },
  {
    step: "aguardando_conta",
    label: "Esperando a conta de luz",
    suggested: "Falta só a foto da conta de luz pra eu te mostrar quanto dá pra economizar. Pode tirar uma foto bem legível e enviar aqui? 📸",
  },
  {
    step: "aguardando_foto_conta",
    label: "Esperando a foto da conta",
    suggested: "Sem a foto da conta de luz não consigo simular o seu desconto. Pode mandar uma foto bem legível agora? 📸",
  },
  {
    step: "simulacao_apresentada",
    label: "Resultado da simulação",
    suggested: "Vi que você parou logo depois da simulação. Faz sentido o desconto que apresentei? Posso te explicar qualquer parte 💚",
  },
  {
    step: "resultado_simulacao_sim",
    label: "Resultado da simulação — Sim",
    suggested: "Você confirmou que faz sentido o desconto da simulação 👏 Pra eu seguir o cadastro, me envia uma foto da sua conta de luz, por favor.",
  },
  {
    step: "resultado_simulacao_nao",
    label: "Resultado da simulação — Não",
    suggested: "Sem problemas! Se mudar de ideia, é só me chamar aqui que retomo a proposta de onde paramos 💚",
  },
  {
    step: "confirmando_dados",
    label: "Confirmando dados da conta",
    suggested: 'Os dados da conta estão certinhos? Se sim, responde "sim" que seguimos com o cadastro 👍',
  },
  {
    step: "aguardando_doc",
    label: "Esperando o documento (RG/CNH)",
    suggested: "Estamos quase! Falta só a foto do RG ou CNH (frente e verso). Pode mandar por aqui?",
  },
  {
    step: "aguardando_facial",
    label: "Esperando a selfie de validação",
    suggested: "Último passo: uma selfie do seu rosto pra validação. Pode mandar agora?",
  },
  {
    step: "corrigir_celular_portal",
    label: "Corrigindo o celular no portal",
    suggested: "Vi que paramos na etapa de confirmar o celular no portal. Pode me enviar o número correto com DDD pra eu corrigir e seguir o cadastro?",
  },
  {
    step: "portal_submitting",
    label: "Enviando ao portal iGreen",
    suggested: "Seu cadastro está em andamento no portal iGreen. Precisa de ajuda em alguma tela?",
  },
  {
    step: "aguardando_humano",
    label: "Aguardando consultor humano",
    suggested: "Oi! Sou {{representante}} e vou te acompanhar pessoalmente daqui pra frente. Como posso ajudar?",
  },
];

/** Texto sugerido para uma etapa (ou string vazia). */
export function getSuggestedReactivationText(step: string): string {
  return KNOWN_REACTIVATION_STEPS.find((s) => s.step === step)?.suggested ?? "";
}

/** Rótulo amigável de uma etapa (ou o próprio nome técnico se desconhecida). */
export function getStepLabel(step: string): string {
  return KNOWN_REACTIVATION_STEPS.find((s) => s.step === step)?.label ?? step;
}
