import { useParams } from "react-router-dom";
import { useConsultant } from "@/hooks/useConsultant";
import { useTrackView } from "@/hooks/useTrackView";
import { useInstancePhone } from "@/hooks/useInstancePhone";
import LicHeroSection from "@/components/licenciada/LicHeroSection";
import LicAboutSection from "@/components/licenciada/LicAboutSection";
import LicWhySection from "@/components/licenciada/LicWhySection";
import LicBenefitsSection from "@/components/licenciada/LicBenefitsSection";
import LicProductsIntro from "@/components/licenciada/LicProductsIntro";
import LicConexaoGreen from "@/components/licenciada/LicConexaoGreen";
import LicConexaoLivre from "@/components/licenciada/LicConexaoLivre";
import LicConexaoSolar from "@/components/licenciada/LicConexaoSolar";
import LicConexaoPlacas from "@/components/licenciada/LicConexaoPlacas";
import LicConexaoClub from "@/components/licenciada/LicConexaoClub";
import LicConexaoClubPJ from "@/components/licenciada/LicConexaoClubPJ";
import LicConexaoExpansao from "@/components/licenciada/LicConexaoExpansao";
import LicConexaoTelecom from "@/components/licenciada/LicConexaoTelecom";
import LicConexaoSeguros from "@/components/licenciada/LicConexaoSeguros";
import LicCareerPlan from "@/components/licenciada/LicCareerPlan";
import LicLicenseSection from "@/components/licenciada/LicLicenseSection";
import LicConsultantSection from "@/components/licenciada/LicConsultantSection";
import LicUrgencyBanner from "@/components/licenciada/LicUrgencyBanner";
import LicIntermediateCTA from "@/components/licenciada/LicIntermediateCTA";
import WhatsAppFloat from "@/components/WhatsAppFloat";
import LoadingScreen from "@/components/LoadingScreen";
import SEOHead from "@/components/SEOHead";
import PixelInjector from "@/components/PixelInjector";
import PageStatus from "@/components/common/PageStatus";
import { useEffect } from "react";
import { captureLeadSource } from "@/lib/fbclid";

const LicenciadaPage = () => {
  const { licenca } = useParams<{ licenca: string }>();
  const { data: consultant, isLoading } = useConsultant(licenca || "");
  useTrackView(consultant?.id, "licenciada");
  const { data: instancePhone } = useInstancePhone(consultant?.id);
  useEffect(() => { captureLeadSource(); }, []);

  if (isLoading) return <LoadingScreen />;

  if (!consultant) {
    return (
      <PageStatus
        title="Licenciado não encontrado"
        description="Verifique o link e tente novamente."
      />
    );
  }

  const rawPhone = consultant.phone?.replace(/\D/g, "") || "";
  const normalizedPhone = rawPhone
    ? rawPhone.startsWith("55")
      ? rawPhone
      : `55${rawPhone}`
    : "";
  const contactPhone = instancePhone || normalizedPhone;
  const whatsappUrl = contactPhone
    ? `https://wa.me/${contactPhone}?text=${encodeURIComponent("Olá, gostaria de mais informações sobre a oportunidade de Licenciado iGreen Energy")}`
    : "#";

  return (
    <>
      <PixelInjector facebookPixelId={consultant.facebook_pixel_id} googleAnalyticsId={consultant.google_analytics_id} />
      <SEOHead
        title={`Licenciado ${consultant.name} – iGreen Energy`}
        description={`Descubra como se tornar um Licenciado iGreen Energy com ${consultant.name} e receba comissões recorrentes`}
      />
      <div className="min-h-screen">
        <LicHeroSection cadastroUrl={consultant.licenciada_cadastro_url || consultant.cadastro_url} whatsappUrl={whatsappUrl} consultantId={consultant.id} />
        <LicUrgencyBanner />
        <LicAboutSection />
        <LicWhySection />
        <LicBenefitsSection />
        <LicIntermediateCTA
          whatsappUrl={whatsappUrl}
          consultantId={consultant.id}
          headline="Não deixe essa oportunidade passar!"
          subtext="Quem começou há 1 ano já construiu uma renda recorrente sólida. O próximo pode ser você."
          emoji="⏰"
        />
        <LicProductsIntro />
        <LicConexaoGreen />
        <LicConexaoLivre />
        <LicConexaoSolar />
        <LicConexaoPlacas />
        <LicIntermediateCTA
          whatsappUrl={whatsappUrl}
          consultantId={consultant.id}
          headline="Você já viu o potencial. Agora é a hora de agir."
          subtext="Cada dia que passa é dinheiro que você deixa na mesa. Entre agora e comece a faturar com 9 produtos diferentes."
          emoji="💰"
        />
        <LicConexaoClub />
        <LicConexaoClubPJ />
        <LicConexaoExpansao />
        <LicConexaoTelecom />
        <LicConexaoSeguros />
        <LicCareerPlan />
        <LicLicenseSection />
        <LicConsultantSection
          name={consultant.name}
          whatsappUrl={whatsappUrl}
          photoUrl={consultant.photo_url}
          igreenId={consultant.igreen_id}
        />
      </div>
      <WhatsAppFloat url={whatsappUrl} />
    </>
  );
};

export default LicenciadaPage;
