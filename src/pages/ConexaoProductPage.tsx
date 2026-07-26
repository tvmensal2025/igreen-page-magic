import { useParams, useLocation } from "react-router-dom";
import { useState } from "react";
import { useConsultant } from "@/hooks/useConsultant";
import { useTrackView } from "@/hooks/useTrackView";
import { useInstancePhone } from "@/hooks/useInstancePhone";
import LazyVideo from "@/components/ui/LazyVideo";
import { conexaoVideoUrl, conexaoPosterUrl } from "@/lib/conexaoVideos";
import WhatsAppFloat from "@/components/WhatsAppFloat";
import SEOHead from "@/components/SEOHead";
import LoadingScreen from "@/components/LoadingScreen";
import PageStatus from "@/components/common/PageStatus";
import { CanonicalLicenseRedirect } from "@/components/common/CanonicalLicenseRedirect";
import { useProduct, resolveLanding, type ResolvedLanding, type ProductSection } from "@/features/produtos/catalogo";
import consultantDefault from "@/assets/consultant.jpg";
import { trackClickEvent } from "@/hooks/useTrackEvent";

// ─────────────────────────────────────────────
// Página reutilizável para os produtos "Conexão"
// Rota: /conexao-<produto>/:licenca
//
// O conteúdo vem do catálogo no banco (tabela products) via useProduct.
// Se o produto estiver ativo e landing_content vazio, resolveLanding usa o
// catálogo estático só para campos. Produto inativo/ausente → 404.
// ─────────────────────────────────────────────

const ConexaoProductPage = () => {
  const { licenca } = useParams<{ licenca: string }>();
  const location = useLocation();

  // Extrai o slug do produto a partir do pathname (ex: /conexao-telecom/abc → "conexao-telecom")
  const productSlug = location.pathname.split("/")[1];

  const { data: dbProduct, isLoading: isProductLoading } = useProduct(productSlug);
  const product = resolveLanding(dbProduct, productSlug);

  const { data: consultant, isLoading } = useConsultant(licenca || "");
  useTrackView(consultant?.id, productSlug || "client");

  const { data: instancePhone } = useInstancePhone(consultant?.id);

  if (isLoading || isProductLoading) return <LoadingScreen />;

  if (!product) {
    return (
      <PageStatus
        title="Produto não encontrado"
        description="Verifique o link e tente novamente."
      />
    );
  }

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

  // Normalizar telefone
  const rawPhone = consultant.phone?.replace(/\D/g, "") || "";
  const normalizedPhone = rawPhone.startsWith("55") ? rawPhone : `55${rawPhone}`;
  const contactPhone = instancePhone || normalizedPhone;

  const whatsappUrl = `https://wa.me/${contactPhone}?text=${encodeURIComponent(product.whatsappMessage)}`;

  return (
    <>
      <SEOHead
        title={`${product.name} – ${consultant.name}`}
        description={product.heroSubtitle}
      />
      <div className="min-h-screen bg-background overflow-x-hidden">
        {/* ═══ HERO ═══ */}
        <HeroSection product={product} whatsappUrl={whatsappUrl} />

        {/* ═══ SEÇÕES DINÂMICAS ═══ */}
        {product.sections.map((section, idx) => (
          <DynamicSection
            key={`${section.type}-${idx}`}
            section={section}
            productSlug={product.slug}
            whatsappUrl={whatsappUrl}
            ctaLabel={product.ctaLabel}
          />
        ))}

        {/* ═══ CONSULTOR ═══ */}
        <ConsultorSection
          consultant={consultant}
          whatsappUrl={whatsappUrl}
          product={product}
        />
      </div>
      <WhatsAppFloat url={whatsappUrl} />
    </>
  );
};

export default ConexaoProductPage;

// ═══════════════════════════════════════════════
// COMPONENTES INTERNOS
// ═══════════════════════════════════════════════

interface HeroProps {
  product: ResolvedLanding;
  whatsappUrl: string;
}

function HeroSection({ product, whatsappUrl }: HeroProps) {
  return (
    <section
      className="relative overflow-hidden py-12 md:py-20"
      style={{ background: product.gradient }}
    >
      <div className="section-container relative z-10">
        <h1 className="font-heading text-2xl sm:text-3xl md:text-4xl lg:text-5xl font-bold text-white text-center leading-tight mb-4">
          {product.heroTitle}
        </h1>
        <p className="text-white/80 text-center text-sm sm:text-base md:text-lg max-w-3xl mx-auto mb-8">
          {product.heroSubtitle}
        </p>

        <div className="max-w-3xl mx-auto mb-8">
          <LazyVideo
            src={conexaoVideoUrl(product.heroVideoId)}
            poster={conexaoPosterUrl(product.heroVideoId)}
            label={`Vídeo ${product.name}`}
            className="w-full aspect-video rounded-2xl shadow-2xl"
          />
        </div>

        <div className="text-center">
          <a
            href={whatsappUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex max-w-full items-center justify-center bg-[#25D366] hover:bg-[#20bd5a] text-white font-heading font-bold text-sm sm:text-base md:text-lg px-5 sm:px-8 py-3.5 sm:py-4 rounded-full shadow-lg transition-all duration-300 hover:scale-105 animate-pulse text-center"
          >
            {product.ctaLabel}
          </a>
        </div>
      </div>
    </section>
  );
}

interface DynamicSectionProps {
  section: ProductSection;
  productSlug: string;
  whatsappUrl: string;
  ctaLabel: string;
}

function DynamicSection({ section, productSlug, whatsappUrl, ctaLabel }: DynamicSectionProps) {
  switch (section.type) {
    case "about":
      return <AboutSection section={section} />;
    case "video":
      return <VideoSection section={section} />;
    case "plans":
      return <PlansSection section={section} />;
    case "benefits":
      return <BenefitsSection section={section} />;
    case "gallery":
      return <GallerySection section={section} productSlug={productSlug} />;
    case "faq":
      return <FAQSection section={section} />;
    case "advantages":
      return <AdvantagesSection section={section} whatsappUrl={whatsappUrl} ctaLabel={ctaLabel} />;
    default:
      return null;
  }
}

// ─── ABOUT ───
function AboutSection({ section }: { section: ProductSection }) {
  return (
    <section className="relative overflow-hidden py-16 md:py-20">
      <div className="section-container">
        <div className="badge-green mx-auto mb-6">{section.title}</div>
        <h2 className="section-heading">{section.title}</h2>
        {section.subtitle && (
          <p className="text-center text-muted-foreground max-w-2xl mx-auto mb-10">
            {section.subtitle}
          </p>
        )}

        <div className="glass-card max-w-3xl mx-auto p-6 md:p-8">
          <ul className="space-y-4">
            {section.items?.map((item, i) => (
              <li key={i} className="flex items-start gap-3 text-foreground/90 min-w-0">
                <span className="text-lg shrink-0">✅</span>
                <span className="min-w-0 break-words">{item}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}

// ─── VIDEO ───
function VideoSection({ section }: { section: ProductSection }) {
  if (!section.videoId) return null;
  return (
    <section className="relative overflow-hidden py-16 md:py-20">
      <div className="section-container">
        <h2 className="section-heading">{section.title}</h2>
        {section.subtitle && (
          <p className="text-center text-muted-foreground max-w-2xl mx-auto mb-10">
            {section.subtitle}
          </p>
        )}
        <div className="max-w-3xl mx-auto">
          <LazyVideo
            src={conexaoVideoUrl(section.videoId)}
            poster={conexaoPosterUrl(section.videoId)}
            label={section.title}
            className="w-full aspect-video rounded-2xl shadow-lg"
          />
        </div>
      </div>
    </section>
  );
}

// ─── PLANS ───
function PlansSection({ section }: { section: ProductSection }) {
  return (
    <section className="relative overflow-hidden py-16 md:py-20">
      <div className="section-container">
        <h2 className="section-heading">{section.title}</h2>
        {section.subtitle && (
          <p className="text-center text-muted-foreground max-w-2xl mx-auto mb-10">
            {section.subtitle}
          </p>
        )}
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6 max-w-5xl mx-auto">
          {section.items?.map((item, i) => {
            const [emoji, ...rest] = item.split(" ");
            const text = rest.join(" ");
            const [planName, ...details] = text.split(" — ");
            return (
              <div key={i} className="glass-card p-6 text-center">
                <span className="text-4xl block mb-3">{emoji}</span>
                <h3 className="font-heading font-bold text-lg text-foreground mb-2">{planName}</h3>
                {details.length > 0 && (
                  <p className="text-sm text-muted-foreground">{details.join(" — ")}</p>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

// ─── BENEFITS ───
function BenefitsSection({ section }: { section: ProductSection }) {
  return (
    <section className="relative overflow-hidden py-16 md:py-20">
      <div className="section-container">
        <h2 className="section-heading">{section.title}</h2>
        {section.subtitle && (
          <p className="text-center text-muted-foreground max-w-2xl mx-auto mb-10">
            {section.subtitle}
          </p>
        )}
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4 max-w-5xl mx-auto">
          {section.items?.map((item, i) => (
            <div key={i} className="glass-card p-5 flex items-start gap-3 min-w-0">
              <span className="text-lg shrink-0">✅</span>
              <span className="text-foreground/90 text-sm min-w-0 break-words">{item}</span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

// ─── GALLERY ───
function GallerySection({ section, productSlug }: { section: ProductSection; productSlug: string }) {
  return (
    <section className="relative overflow-hidden py-16 md:py-20">
      <div className="section-container">
        <h2 className="section-heading">{section.title}</h2>
        {section.subtitle && (
          <p className="text-center text-muted-foreground max-w-2xl mx-auto mb-10">
            {section.subtitle}
          </p>
        )}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4 max-w-5xl mx-auto">
          {section.images?.map((img, i) => (
            <img
              key={i}
              src={img.startsWith("/") ? img : `/conexao/${productSlug}/${img}`}
              alt={`${section.title} ${i + 1}`}
              loading="lazy"
              decoding="async"
              className="rounded-2xl w-full max-w-full h-auto object-cover shadow-md hover:scale-[1.02] transition-transform duration-300"
            />
          ))}
        </div>
      </div>
    </section>
  );
}

// ─── FAQ ───
function FAQSection({ section }: { section: ProductSection }) {
  const [openIndex, setOpenIndex] = useState<number | null>(null);

  return (
    <section className="relative overflow-hidden py-16 md:py-20">
      <div className="section-container">
        <h2 className="section-heading">{section.title}</h2>
        {section.subtitle && (
          <p className="text-center text-muted-foreground max-w-2xl mx-auto mb-10">
            {section.subtitle}
          </p>
        )}
        <div className="max-w-3xl mx-auto space-y-3">
          {section.faq?.map((item, i) => (
            <div key={i} className="glass-card overflow-hidden">
              <button
                type="button"
                onClick={() => setOpenIndex(openIndex === i ? null : i)}
                className="w-full flex items-center justify-between gap-3 p-4 sm:p-5 text-left min-w-0"
                aria-expanded={openIndex === i}
              >
                <span className="font-heading font-semibold text-foreground min-w-0 pr-2 break-words">
                  {item.question}
                </span>
                <svg
                  className={`w-5 h-5 shrink-0 text-primary transition-transform duration-300 ${openIndex === i ? "rotate-180" : ""}`}
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </button>
              <div
                className={`overflow-hidden transition-all duration-300 ${openIndex === i ? "max-h-96 pb-5 px-5" : "max-h-0"}`}
              >
                <p className="text-muted-foreground text-sm">{item.answer}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

// ─── ADVANTAGES ───
function AdvantagesSection({
  section,
  whatsappUrl,
  ctaLabel,
}: {
  section: ProductSection;
  whatsappUrl: string;
  ctaLabel: string;
}) {
  return (
    <section className="relative overflow-hidden py-16 md:py-20">
      <div className="section-container">
        <h2 className="section-heading">{section.title}</h2>
        {section.subtitle && (
          <p className="text-center text-muted-foreground max-w-2xl mx-auto mb-10">
            {section.subtitle}
          </p>
        )}
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4 max-w-5xl mx-auto mb-10">
          {section.items?.map((item, i) => (
            <div key={i} className="glass-card p-5 flex items-start gap-3">
              <span className="text-foreground/90 text-sm">{item}</span>
            </div>
          ))}
        </div>
        <div className="text-center">
          <a
            href={whatsappUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-block bg-[#25D366] hover:bg-[#20bd5a] text-white font-heading font-bold text-sm sm:text-base px-8 py-4 rounded-full shadow-lg transition-all duration-300 hover:scale-105"
          >
            {ctaLabel}
          </a>
        </div>
      </div>
    </section>
  );
}

// ─── CONSULTOR ───
interface ConsultorSectionProps {
  consultant: NonNullable<ReturnType<typeof useConsultant>["data"]>;
  whatsappUrl: string;
  product: ResolvedLanding;
}

function ConsultorSection({ consultant, whatsappUrl, product }: ConsultorSectionProps) {
  const photo = consultant.photo_url || consultantDefault;
  const displayId = consultant.igreen_id || "";

  const handleClick = (target: string) => {
    if (consultant.id) trackClickEvent(consultant.id, target, product.slug || "client");
  };

  return (
    <section className="relative overflow-hidden">
      <div className="green-divider-glow" />

      {/* Background glow */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden">
        <div
          className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] rounded-full opacity-[0.06]"
          style={{ background: "radial-gradient(circle, hsl(130, 100%, 36%), transparent 70%)" }}
        />
      </div>

      <div className="section-container relative z-10">
        <div className="badge-green mx-auto mb-6">Seu consultor</div>
        <h2 className="section-heading mb-2 break-words px-1">{consultant.name}</h2>
        <p
          className="text-center font-heading font-bold text-base sm:text-lg mb-12 break-words px-1"
          style={{ color: "hsl(var(--primary))" }}
        >
          Consultor(a) {product.brandName} — ID {displayId}
        </p>

        <div className="grid md:grid-cols-2 gap-8 md:gap-12 items-center max-w-4xl mx-auto">
          <div className="relative group min-w-0">
            <div className="media-glow" />
            <img
              src={photo}
              alt={`${consultant.name} - Consultor(a) ${product.brandName}`}
              loading="lazy"
              decoding="async"
              className="rounded-2xl w-full max-w-sm max-w-full mx-auto shadow-lg relative z-10 transition-transform duration-500 group-hover:scale-[1.02]"
              style={{ boxShadow: "var(--shadow-green)" }}
            />
          </div>

          <div className="min-w-0">
            <h3 className="font-heading font-bold text-xl sm:text-2xl mb-6 text-foreground break-words">
              {consultant.name}
            </h3>
            <div className="space-y-4 mb-10">
              <div className="glass-card !p-4 !rounded-xl flex items-start gap-3 min-w-0">
                <span className="text-lg shrink-0">✅</span>
                <span className="text-foreground/90 min-w-0 break-words">
                  Estou muito feliz com seu interesse em conhecer a {product.brandName} e será um grande prazer tê-lo(a) conosco
                </span>
              </div>
              <div className="glass-card !p-4 !rounded-xl flex items-start gap-3 min-w-0">
                <span className="text-lg shrink-0">✅</span>
                <span className="text-foreground/90 min-w-0 break-words">
                  Estou à disposição para tirar todas as suas dúvidas e fornecer o melhor suporte. Pode contar comigo!
                </span>
              </div>
              <div className="glass-card !p-4 !rounded-xl flex items-start gap-3 min-w-0">
                <span className="text-lg shrink-0">✅</span>
                <span className="text-foreground/90 min-w-0 break-words">
                  Envie uma mensagem e comece a aproveitar todos os benefícios da {product.brandName} hoje mesmo
                </span>
              </div>
            </div>

            <a
              href={whatsappUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="btn-whatsapp w-full !py-4 text-center block"
              onClick={() => handleClick("whatsapp")}
            >
              💬 Falar no WhatsApp
            </a>
          </div>
        </div>
      </div>

      {/* Footer */}
      <footer className="bg-card/50 py-10 px-4 text-center mt-16 border-t border-border public-page-safe-bottom">
        <img
          src="/images/logo-colorida-igreen.png"
          alt="iGreen Energy"
          loading="lazy"
          decoding="async"
          className="mx-auto mb-4 w-36 max-w-full h-auto"
        />
        <p className="text-muted-foreground font-heading text-sm tracking-wider break-words px-2">
          {consultant.name?.toUpperCase()} | CONSULTOR(A) {product.brandName.toUpperCase()}
          {displayId ? ` ID ${displayId}` : ""}
        </p>
      </footer>
    </section>
  );
}
