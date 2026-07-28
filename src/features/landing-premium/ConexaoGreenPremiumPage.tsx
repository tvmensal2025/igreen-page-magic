import { useCallback, useEffect, useRef } from "react";
import { useParams, useSearchParams } from "react-router-dom";

import { useConsultant } from "@/hooks/useConsultant";
import { useInstancePhone } from "@/hooks/useInstancePhone";
import { useTrackView } from "@/hooks/useTrackView";
import { trackClickEvent } from "@/hooks/useTrackEvent";
import LoadingScreen from "@/components/LoadingScreen";
import PageStatus from "@/components/common/PageStatus";
import PixelInjector from "@/components/PixelInjector";
import WhatsAppFloat from "@/components/WhatsAppFloat";
import { CanonicalLicenseRedirect } from "@/components/common/CanonicalLicenseRedirect";

import "./premium.css";
import PremiumHead from "./PremiumHead";
import { useReveal } from "./useReveal";
import PremiumSiteNav from "./shared/PremiumSiteNav";
import PremiumHero from "./components/PremiumHero";
import PremiumDock from "./components/PremiumDock";
import PremiumSimulator from "./components/PremiumSimulator";
import {
  PremiumBenefits,
  PremiumCashback,
  PremiumClub,
  PremiumComparison,
  PremiumCoverage,
  PremiumHowItWorks,
  PremiumObjections,
  PremiumProblem,
  PremiumProof,
  PremiumSolution,
} from "./components/PremiumSections";
import { PremiumConsultant, PremiumFaq, PremiumFinal } from "./components/PremiumClosing";

const DEFAULT_CADASTRO_URL = "https://digital.igreenenergy.com.br/?sendcontract=true";

/** Origens de anúncio reconhecidas — mesma lista da LP atual. */
const ADS_SOURCES = [
  "ads",
  "anuncio",
  "anúncio",
  "facebook",
  "instagram",
  "fb",
  "ig",
  "meta",
];

/**
 * LP premium do Conexão Green.
 *
 * Rota: `/conexao-green-premium/:licenca` (alias `/premium/:licenca`).
 *
 * Relação com a LP atual: nenhuma. A `ConsultantPage` (`/:licenca`) continua
 * exatamente como estava — esta página é um arquivo novo, com CSS escopado em
 * `.lpx`, e não altera nenhum componente compartilhado.
 *
 * O que é reaproveitado de propósito (integrações, não visual):
 * - `useConsultant` / `useInstancePhone`: resolvem o consultor e o número de
 *   atendimento com a mesma regra da LP original (instância Whapi tem
 *   prioridade sobre o telefone do perfil).
 * - `useTrackView` / `trackClickEvent`: as métricas da premium caem no mesmo
 *   funil, então dá para comparar as duas versões lado a lado.
 * - `PixelInjector`: pixel do Facebook e GA do consultor.
 * - `CanonicalLicenseRedirect`: mantém a licença canônica na URL.
 */
const ConexaoGreenPremiumPage = () => {
  const { licenca } = useParams<{ licenca: string }>();
  const [searchParams] = useSearchParams();
  const rootRef = useRef<HTMLDivElement>(null);

  const { data: consultant, isLoading } = useConsultant(licenca || "");
  const { data: instancePhone } = useInstancePhone(consultant?.id);

  useTrackView(consultant?.id, "client");
  useReveal(rootRef);

  // Sobe o FAB global de WhatsApp para ele não colidir com o dock do mobile.
  // A classe sai no unmount, então nenhuma outra página é afetada.
  useEffect(() => {
    document.body.classList.add("lpx-has-dock");
    return () => document.body.classList.remove("lpx-has-dock");
  }, []);

  const consultantId = consultant?.id;
  const track = useCallback(
    (target: string) => {
      if (consultantId) trackClickEvent(consultantId, target, "client");
    },
    [consultantId],
  );

  const trackWhatsApp = useCallback(() => track("whatsapp"), [track]);
  const trackCadastro = useCallback(() => track("cadastro"), [track]);
  const trackSimulator = useCallback(() => track("whatsapp_simulador"), [track]);

  if (isLoading) return <LoadingScreen />;

  if (!consultant) {
    return (
      <PageStatus
        title="Consultor não encontrado"
        description="Verifique o link e tente novamente."
      />
    );
  }

  // Mantém a licença canônica na URL (mesma regra da LP original).
  if (licenca && consultant.license && licenca !== consultant.license) {
    return <CanonicalLicenseRedirect paramLicense={licenca} canonicalLicense={consultant.license} />;
  }

  // Telefone de atendimento: instância conectada primeiro, perfil como reserva.
  const rawPhone = consultant.phone?.replace(/\D/g, "") || "";
  const normalizedPhone = rawPhone.startsWith("55") ? rawPhone : `55${rawPhone}`;
  const contactPhone = instancePhone || normalizedPhone;

  const srcParam = (
    searchParams.get("src") ||
    searchParams.get("utm_source") ||
    ""
  ).toLowerCase();
  const isAdsMode = ADS_SOURCES.includes(srcParam);

  const waLink = (message: string) =>
    `https://wa.me/${contactPhone}?text=${encodeURIComponent(message)}`;

  // Em tráfego de anúncio a mensagem precisa conter a marcação que o bot usa
  // para classificar a origem (lead_source = meta_ads). Mesma regra da LP atual.
  const adsPrefix = isAdsMode
    ? "Oi! Vim do anúncio do Facebook/Instagram e "
    : "Olá! ";

  const primaryWhatsAppUrl = waLink(
    `${adsPrefix}quero saber quanto consigo de desconto na minha conta de luz com a iGreen Energy.`,
  );

  /** Mensagem do simulador: leva o valor informado, já qualificando a conversa. */
  const buildSimulatorUrl = (billValue: number) => {
    if (!billValue || billValue <= 0) return primaryWhatsAppUrl;
    const formatted = billValue.toLocaleString("pt-BR", {
      style: "currency",
      currency: "BRL",
      maximumFractionDigits: 0,
    });
    return waLink(
      `${adsPrefix}minha conta de luz é de cerca de ${formatted} por mês. Quero confirmar meu desconto real na iGreen Energy.`,
    );
  };

  const cadastroUrl = consultant.cadastro_url || DEFAULT_CADASTRO_URL;
  const firstName = consultant.name?.split(" ")[0] || "consultor";

  return (
    <>
      <PixelInjector
        facebookPixelId={consultant.facebook_pixel_id}
        googleAnalyticsId={consultant.google_analytics_id}
      />
      <PremiumHead
        title={`Conta de luz até 20% mais barata | ${consultant.name} – iGreen Energy`}
        description={`Energia solar por assinatura com até 20% de desconto na conta de luz, sem instalar placas e sem taxa de adesão. Fale com ${firstName}, consultor(a) iGreen Energy, e receba a análise da sua fatura.`}
        consultantName={consultant.name}
      />

      <div ref={rootRef} className="lpx" data-produto="conexao-green">
        {/* Navegação compartilhada: dá acesso às outras 8 soluções mantendo a
            licença do consultor na URL. Substitui a PremiumNav local, que só
            tinha âncoras desta página. */}
        <PremiumSiteNav
          licenca={consultant.license}
          atual="conexao-green"
          ancoras={[
            { label: "Simular", href: "#simulador" },
            { label: "Como funciona", href: "#como-funciona" },
            { label: "Benefícios", href: "#beneficios" },
            { label: "Dúvidas", href: "#faq" },
          ]}
          whatsappUrl={primaryWhatsAppUrl}
          ctaLabel="Falar com o consultor"
          onWhatsAppClick={trackWhatsApp}
        />

        {/* `main` com H1 único no hero — hierarquia de headings previsível. */}
        <main>
          <PremiumHero
            whatsappUrl={primaryWhatsAppUrl}
            cadastroUrl={cadastroUrl}
            onWhatsAppClick={trackWhatsApp}
            onCadastroClick={trackCadastro}
          />

          <PremiumSimulator
            buildWhatsAppUrl={buildSimulatorUrl}
            onWhatsAppClick={trackSimulator}
          />

          <PremiumProblem />
          <PremiumSolution />
          <PremiumHowItWorks />
          <PremiumBenefits />
          <PremiumCashback />
          <PremiumClub />
          <PremiumComparison />
          <PremiumProof />
          <PremiumObjections />
          <PremiumCoverage />
          <PremiumFaq />

          <PremiumConsultant
            name={consultant.name}
            photoUrl={consultant.photo_url}
            igreenId={consultant.igreen_id}
            whatsappUrl={primaryWhatsAppUrl}
            cadastroUrl={cadastroUrl}
            onWhatsAppClick={trackWhatsApp}
            onCadastroClick={trackCadastro}
          />

          <PremiumFinal
            consultantName={consultant.name}
            igreenId={consultant.igreen_id}
            whatsappUrl={primaryWhatsAppUrl}
            cadastroUrl={cadastroUrl}
            onWhatsAppClick={trackWhatsApp}
            onCadastroClick={trackCadastro}
          />
        </main>

        {/* Reserva a altura do dock para ele não cobrir o fim do rodapé. */}
        <div className="lpx-dock-spacer" aria-hidden="true" />

        <PremiumDock
          whatsappUrl={primaryWhatsAppUrl}
          cadastroUrl={cadastroUrl}
          onWhatsAppClick={trackWhatsApp}
          onCadastroClick={trackCadastro}
        />
      </div>

      <WhatsAppFloat url={primaryWhatsAppUrl} onClickTrack={trackWhatsApp} />
    </>
  );
};

export default ConexaoGreenPremiumPage;
