// =============================================================================
// Catálogo — Seções da landing do produto (reutilizável)
// =============================================================================
// Renderiza o conteúdo COMPLETO da landing de um produto (hero + todas as
// seções dinâmicas: sobre, vídeo, planos, benefícios, galeria, FAQ, vantagens).
// É usado tanto pela página pública do produto (ConexaoProductPage) quanto
// abaixo da proposta (ProposalPublicPage), garantindo que a proposta exiba a
// MESMA landing completa, com todas as informações.
//
// O CTA é configurável: na landing do produto é o WhatsApp; na proposta o CTA
// é omitido (a ação fica nos botões de aceitar/recusar no topo).
// =============================================================================

import { useState } from "react";
import LazyVideo from "@/components/ui/LazyVideo";
import { conexaoVideoUrl, conexaoPosterUrl } from "@/lib/conexaoVideos";
import type { ResolvedLanding } from "./resolveLanding";
import type { ProductSection } from "./types";

interface ProductLandingSectionsProps {
  product: ResolvedLanding;
  /** URL do CTA (WhatsApp). Quando ausente, os botões de CTA não aparecem. */
  ctaUrl?: string;
  /** Mostra o hero (título + subtítulo + vídeo). Default: true. */
  showHero?: boolean;
}

/** Renderiza a landing completa do produto (hero + seções). */
export function ProductLandingSections({
  product,
  ctaUrl,
  showHero = true,
}: ProductLandingSectionsProps) {
  return (
    <div className="bg-background">
      {showHero && <HeroSection product={product} ctaUrl={ctaUrl} />}
      {product.sections.map((section, idx) => (
        <DynamicSection
          key={`${section.type}-${idx}`}
          section={section}
          productSlug={product.slug}
          ctaUrl={ctaUrl}
          ctaLabel={product.ctaLabel}
        />
      ))}
    </div>
  );
}

interface HeroProps {
  product: ResolvedLanding;
  ctaUrl?: string;
}

function HeroSection({ product, ctaUrl }: HeroProps) {
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

        {product.heroVideoId && (
          <div className="max-w-3xl mx-auto mb-8">
            <div className="aspect-video w-full overflow-hidden rounded-2xl shadow-2xl bg-black/40">
              <LazyVideo
                src={conexaoVideoUrl(product.heroVideoId)}
                poster={conexaoPosterUrl(product.heroVideoId)}
                label={`Vídeo ${product.name}`}
                className="w-full h-full object-cover"
              />
            </div>
          </div>
        )}

        {ctaUrl && (
          <div className="text-center">
            <a
              href={ctaUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-block bg-[#25D366] hover:bg-[#20bd5a] text-white font-heading font-bold text-sm sm:text-base md:text-lg px-8 py-4 rounded-full shadow-lg transition-all duration-300 hover:scale-105 animate-pulse"
            >
              {product.ctaLabel}
            </a>
          </div>
        )}
      </div>
    </section>
  );
}

interface DynamicSectionProps {
  section: ProductSection;
  productSlug: string;
  ctaUrl?: string;
  ctaLabel: string;
}

function DynamicSection({ section, productSlug, ctaUrl, ctaLabel }: DynamicSectionProps) {
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
      return <AdvantagesSection section={section} ctaUrl={ctaUrl} ctaLabel={ctaLabel} />;
    default:
      return null;
  }
}

function AboutSection({ section }: { section: ProductSection }) {
  return (
    <section className="relative overflow-hidden py-10 md:py-20">
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
              <li key={i} className="flex items-start gap-3 text-foreground/90">
                <span className="text-lg shrink-0">✅</span>
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}

function VideoSection({ section }: { section: ProductSection }) {
  if (!section.videoId) return null;
  return (
    <section className="relative overflow-hidden py-10 md:py-20">
      <div className="section-container">
        <h2 className="section-heading">{section.title}</h2>
        {section.subtitle && (
          <p className="text-center text-muted-foreground max-w-2xl mx-auto mb-10">
            {section.subtitle}
          </p>
        )}
        <div className="max-w-3xl mx-auto">
          <div className="aspect-video w-full overflow-hidden rounded-2xl shadow-lg bg-black/40">
            <LazyVideo
              src={conexaoVideoUrl(section.videoId)}
              poster={conexaoPosterUrl(section.videoId)}
              label={section.title}
              className="w-full h-full object-cover"
            />
          </div>
        </div>
      </div>
    </section>
  );
}

function PlansSection({ section }: { section: ProductSection }) {
  return (
    <section className="relative overflow-hidden py-10 md:py-20">
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

function BenefitsSection({ section }: { section: ProductSection }) {
  return (
    <section className="relative overflow-hidden py-10 md:py-20">
      <div className="section-container">
        <h2 className="section-heading">{section.title}</h2>
        {section.subtitle && (
          <p className="text-center text-muted-foreground max-w-2xl mx-auto mb-10">
            {section.subtitle}
          </p>
        )}
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4 max-w-5xl mx-auto">
          {section.items?.map((item, i) => (
            <div key={i} className="glass-card p-5 flex items-start gap-3">
              <span className="text-lg shrink-0">✅</span>
              <span className="text-foreground/90 text-sm">{item}</span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function GallerySection({ section, productSlug }: { section: ProductSection; productSlug: string }) {
  return (
    <section className="relative overflow-hidden py-10 md:py-20">
      <div className="section-container">
        <h2 className="section-heading">{section.title}</h2>
        {section.subtitle && (
          <p className="text-center text-muted-foreground max-w-2xl mx-auto mb-10">
            {section.subtitle}
          </p>
        )}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 sm:gap-4 max-w-5xl mx-auto">
          {section.images?.map((img, i) => (
            <img
              key={i}
              src={img.startsWith("/") ? img : `/conexao/${productSlug}/${img}`}
              alt={`${section.title} ${i + 1}`}
              loading="lazy"
              decoding="async"
              className="rounded-2xl w-full h-40 sm:h-44 object-cover shadow-md hover:scale-[1.02] transition-transform duration-300"
              onError={(e) => {
                (e.currentTarget as HTMLImageElement).style.display = "none";
              }}
            />
          ))}
        </div>
      </div>
    </section>
  );
}

function FAQSection({ section }: { section: ProductSection }) {
  const [openIndex, setOpenIndex] = useState<number | null>(null);
  return (
    <section className="relative overflow-hidden py-10 md:py-20">
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
                className="w-full flex items-center justify-between p-5 text-left"
                aria-expanded={openIndex === i}
              >
                <span className="font-heading font-semibold text-foreground pr-4">
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

function AdvantagesSection({
  section,
  ctaUrl,
  ctaLabel,
}: {
  section: ProductSection;
  ctaUrl?: string;
  ctaLabel: string;
}) {
  return (
    <section className="relative overflow-hidden py-10 md:py-20">
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
        {ctaUrl && (
          <div className="text-center">
            <a
              href={ctaUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-block bg-[#25D366] hover:bg-[#20bd5a] text-white font-heading font-bold text-sm sm:text-base px-8 py-4 rounded-full shadow-lg transition-all duration-300 hover:scale-105"
            >
              {ctaLabel}
            </a>
          </div>
        )}
      </div>
    </section>
  );
}
