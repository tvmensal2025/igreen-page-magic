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
import LicCareerPlan from "@/components/licenciada/LicCareerPlan";
import LicLicenseSection from "@/components/licenciada/LicLicenseSection";
import LicConsultantSection from "@/components/licenciada/LicConsultantSection";
import LicUrgencyBanner from "@/components/licenciada/LicUrgencyBanner";
import LicIntermediateCTA from "@/components/licenciada/LicIntermediateCTA";
import WhatsAppFloat from "@/components/WhatsAppFloat";
import SEOHead from "@/components/SEOHead";

const DEFAULT_WHATSAPP = "https://wa.me/5500000000000?text=Ol%C3%A1,%20gostaria%20de%20mais%20informa%C3%A7%C3%B5es%20sobre%20a%20oportunidade%20de%20Licenciado%20iGreen%20Energy";

const LicenciadaPreview = () => (
  <>
    <SEOHead title="Licenciado iGreen Energy" description="Descubra como se tornar um Licenciado iGreen Energy" />
    <div className="min-h-screen overflow-x-hidden">
      <LicHeroSection />
      <LicUrgencyBanner />
      <LicAboutSection />
      <LicWhySection />
      <LicBenefitsSection />
      <LicIntermediateCTA
        whatsappUrl={DEFAULT_WHATSAPP}
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
        whatsappUrl={DEFAULT_WHATSAPP}
        headline="Você já viu o potencial. Agora é a hora de agir."
        subtext="Cada dia que passa é dinheiro que você deixa na mesa. Entre agora e comece a faturar."
        emoji="💰"
      />
      <LicConexaoClub />
      <LicConexaoClubPJ />
      <LicConexaoExpansao />
      <LicConexaoTelecom />
      <LicCareerPlan />
      <LicLicenseSection />
      <LicConsultantSection />
    </div>
    <WhatsAppFloat url={DEFAULT_WHATSAPP} />
  </>
);

export default LicenciadaPreview;
