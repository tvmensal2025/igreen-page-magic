import { lazy, Suspense } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { useConsultant } from "@/hooks/useConsultant";
import { useTrackView } from "@/hooks/useTrackView";
import HeroSection from "@/components/HeroSection";

import AboutSection from "@/components/AboutSection";
import HowItWorksSection from "@/components/HowItWorksSection";
import SolarPlantsSection from "@/components/SolarPlantsSection";
import StatesSection from "@/components/StatesSection";
import ReferralSection from "@/components/ReferralSection";
import TestimonialsSection from "@/components/TestimonialsSection";
import NewsSection from "@/components/NewsSection";
import ClubSection from "@/components/ClubSection";
import AdvantagesSection from "@/components/AdvantagesSection";
import ConsultantSection from "@/components/ConsultantSection";
import WhatsAppFloat from "@/components/WhatsAppFloat";
import LoadingScreen from "@/components/LoadingScreen";
import SEOHead from "@/components/SEOHead";
import PixelInjector from "@/components/PixelInjector";
import PageStatus from "@/components/common/PageStatus";
import { CanonicalLicenseRedirect } from "@/components/common/CanonicalLicenseRedirect";
import { useInstancePhone } from "@/hooks/useInstancePhone";

const SolarCaptacaoWidget = lazy(() =>
  import("@/features/solar-3d").then((m) => ({ default: m.SolarCaptacaoWidget })),
);

const ConsultantPage = () => {
  const { licenca } = useParams<{ licenca: string }>();
  const [searchParams] = useSearchParams();
  const { data: consultant, isLoading } = useConsultant(licenca || "");
  useTrackView(consultant?.id, "client");

  const { data: instancePhone } = useInstancePhone(consultant?.id);

  // Modo CTWA / Anúncio: ?src=ads (ou ?utm_source=ads / facebook / instagram)
  // Versão enxuta da LP: Hero + Vantagens + Depoimentos + Consultor. Mensagem do WhatsApp
  // já indica origem do anúncio para o auto-tag (lead_source = meta_ads).
  const srcParam = (searchParams.get("src") || searchParams.get("utm_source") || "").toLowerCase();
  const isAdsMode = ["ads", "anuncio", "anúncio", "facebook", "instagram", "fb", "ig", "meta"].includes(srcParam);

  if (isLoading) return <LoadingScreen />;

  if (!consultant) {
    return (
      <PageStatus
        title="Consultor não encontrado"
        description="Verifique o link e tente novamente."
      />
    );
  }

  if (licenca && consultant.license && licenca !== consultant.license) {
    return (
      <CanonicalLicenseRedirect paramLicense={licenca} canonicalLicense={consultant.license} />
    );
  }

  // Normalizar telefone do perfil com prefixo 55
  const rawPhone = consultant.phone?.replace(/\D/g, '') || "";
  const normalizedPhone = rawPhone.startsWith("55") ? rawPhone : `55${rawPhone}`;

  // Botão de atendimento: priorizar instância
  const contactPhone = instancePhone || normalizedPhone;

  // Mensagem pré-preenchida — em modo ads usa texto que casa com o auto-tag do bot
  const waMessage = isAdsMode
    ? "Oi! Vim do anúncio do Facebook/Instagram e quero simular minha economia na conta de luz 💡"
    : "Olá, gostaria de mais informações sobre o desconto na conta de luz oferecido pela iGreen Energy";
  const whatsappUrl = `https://wa.me/${contactPhone}?text=${encodeURIComponent(waMessage)}`;

  return (
    <>
      <PixelInjector facebookPixelId={consultant.facebook_pixel_id} googleAnalyticsId={consultant.google_analytics_id} />
      <SEOHead
        title={`${consultant.name} – iGreen Energy`}
        description={`Descubra como receber até 20% de desconto na sua conta de luz com ${consultant.name}, consultor(a) iGreen Energy`}
      />
      <div className="min-h-screen overflow-x-hidden">
        <HeroSection cadastroUrl={consultant.cadastro_url} whatsappUrl={whatsappUrl} consultantId={consultant.id} />

        {(consultant as { solar_public_widget_enabled?: boolean }).solar_public_widget_enabled && (
          <Suspense fallback={null}>
            <div className="section-container">
              <SolarCaptacaoWidget consultantId={consultant.id} />
            </div>
          </Suspense>
        )}

        {isAdsMode ? (
          // Versão CTWA enxuta — foco em conversão direta para WhatsApp
          <>
            <AdvantagesSection />
            <TestimonialsSection />
            <ConsultantSection
              name={consultant.name}
              phone={consultant.phone}
              cadastroUrl={consultant.cadastro_url}
              whatsappUrl={whatsappUrl}
              photoUrl={consultant.photo_url}
              igreenId={consultant.igreen_id}
              consultantId={consultant.id}
            />
          </>
        ) : (
          <>
            <AboutSection />
            <HowItWorksSection />
            <SolarPlantsSection />
            <StatesSection />
            <ReferralSection />
            <TestimonialsSection />
            <NewsSection />
            <ClubSection />
            <AdvantagesSection />
            <ConsultantSection
              name={consultant.name}
              phone={consultant.phone}
              cadastroUrl={consultant.cadastro_url}
              whatsappUrl={whatsappUrl}
              photoUrl={consultant.photo_url}
              igreenId={consultant.igreen_id}
              consultantId={consultant.id}
            />
          </>
        )}
      </div>
      <WhatsAppFloat url={whatsappUrl} />
    </>
  );
};

export default ConsultantPage;
