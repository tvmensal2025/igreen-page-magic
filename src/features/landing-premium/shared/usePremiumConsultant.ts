import { useCallback, useMemo } from "react";
import { useParams, useSearchParams } from "react-router-dom";

import { useConsultant } from "@/hooks/useConsultant";
import { useInstancePhone } from "@/hooks/useInstancePhone";
import { useTrackView } from "@/hooks/useTrackView";
import { trackClickEvent } from "@/hooks/useTrackEvent";
import type { Consultant } from "@/types/consultant";

const DEFAULT_CADASTRO_URL = "https://digital.igreenenergy.com.br/?sendcontract=true";

/**
 * Origens de anúncio reconhecidas.
 *
 * Mesma lista da LP original: quando o tráfego vem de Meta, a mensagem do
 * WhatsApp precisa carregar a marcação que o bot usa para classificar a origem
 * (`lead_source = meta_ads`). Mexer nisso quebra a atribuição de campanha.
 */
const ADS_SOURCES = ["ads", "anuncio", "anúncio", "facebook", "instagram", "fb", "ig", "meta"];

export interface PremiumConsultantState {
  consultant: Consultant | null | undefined;
  isLoading: boolean;
  /** Licença lida da URL (pode divergir da canônica). */
  licenca: string | undefined;
  /** Tráfego de anúncio: muda o texto da mensagem do WhatsApp. */
  isAdsMode: boolean;
  /** Telefone de atendimento já normalizado (instância Whapi tem prioridade). */
  contactPhone: string;
  /** Monta um link wa.me com a mensagem informada. */
  waLink: (mensagem: string) => string;
  /** URL de cadastro do consultor, com o padrão iGreen como reserva. */
  cadastroUrl: string;
  /** Registra um clique no mesmo funil de métricas da página original. */
  track: (alvo: string) => void;
  /** Primeiro nome do consultor, para CTAs personalizados. */
  firstName: string;
}

/**
 * Reúne tudo que as LPs premium precisam do consultor.
 *
 * Existe para que as 9 páginas premium usem exatamente as mesmas regras da LP
 * original — e não cada uma a sua:
 *
 * - Telefone: `whatsapp_instances_public.connected_phone` tem prioridade sobre
 *   `consultants.phone`, porque é o número que de fato está conectado ao Whapi.
 * - Prefixo 55 aplicado uma única vez.
 * - `page_type` no tracking: premium usa sufixo `-premium` (ex.: `conexao-telecom-premium`)
 *   para o painel separar Normal × Premium. Expansão = `expansao-premium`.
 *
 * @param pageType Identificador da página nas métricas (ex.: "conexao-telecom-premium").
 */
export function usePremiumConsultant(pageType: string): PremiumConsultantState {
  const { licenca } = useParams<{ licenca: string }>();
  const [searchParams] = useSearchParams();

  const { data: consultant, isLoading } = useConsultant(licenca || "");
  const { data: instancePhone } = useInstancePhone(consultant?.id);

  useTrackView(consultant?.id, pageType);

  const consultantId = consultant?.id;

  const track = useCallback(
    (alvo: string) => {
      if (consultantId) trackClickEvent(consultantId, alvo, pageType);
    },
    [consultantId, pageType],
  );

  const isAdsMode = useMemo(() => {
    const src = (searchParams.get("src") || searchParams.get("utm_source") || "").toLowerCase();
    return ADS_SOURCES.includes(src);
  }, [searchParams]);

  const contactPhone = useMemo(() => {
    const bruto = consultant?.phone?.replace(/\D/g, "") || "";
    const normalizado = bruto ? (bruto.startsWith("55") ? bruto : `55${bruto}`) : "";
    return instancePhone || normalizado;
  }, [consultant?.phone, instancePhone]);

  const waLink = useCallback(
    (mensagem: string) => {
      // Sem telefone não existe link válido: devolver "#" evita abrir uma
      // conversa vazia com um número inválido (comportamento da LP original).
      if (!contactPhone) return "#";
      return `https://wa.me/${contactPhone}?text=${encodeURIComponent(mensagem)}`;
    },
    [contactPhone],
  );

  return {
    consultant,
    isLoading,
    licenca,
    isAdsMode,
    contactPhone,
    waLink,
    cadastroUrl: consultant?.cadastro_url || DEFAULT_CADASTRO_URL,
    track,
    firstName: consultant?.name?.trim().split(/\s+/)[0] || "consultor",
  };
}

export { DEFAULT_CADASTRO_URL };
