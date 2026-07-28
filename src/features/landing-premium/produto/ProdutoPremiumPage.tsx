import { useCallback, useEffect, useRef } from "react";
import { useLocation } from "react-router-dom";

import LoadingScreen from "@/components/LoadingScreen";
import PageStatus from "@/components/common/PageStatus";
import PixelInjector from "@/components/PixelInjector";
import WhatsAppFloat from "@/components/WhatsAppFloat";
import { CanonicalLicenseRedirect } from "@/components/common/CanonicalLicenseRedirect";
import { conexaoPosterUrl } from "@/lib/conexaoVideos";

import "../premium.css";
import PremiumHead from "../PremiumHead";
import { useReveal } from "../useReveal";
import PremiumSiteNav from "../shared/PremiumSiteNav";
import PremiumDock from "../components/PremiumDock";
import AutoplayVideo from "../shared/AutoplayVideo";
import { usePremiumConsultant } from "../shared/usePremiumConsultant";
import { heroVideoIdDe, produtoPremiumPorSlug, type ProdutoPremium } from "./productPremium";
import {
  BlocoComparacao,
  BlocoDestaques,
  BlocoFaq,
  BlocoGaleria,
  BlocoObjecoes,
  BlocoPassos,
  BlocoPlanos,
  BlocoProblema,
  BlocoSolucao,
  BlocoVideos,
} from "./ProdutoSections";
import { PremiumConsultantCard } from "../shared/PremiumConsultantCard";

/**
 * LP premium dos produtos Conexão.
 *
 * Rota: `/premium/:slugProduto/:licenca`
 *
 * ── Uma página, sete identidades ───────────────────────────────────────────
 * O esqueleto é compartilhado (design system, navegação, dock, rodapé), mas
 * cada produto define no `productPremium.ts` o seu hero, a sua cor de acento e
 * — o mais importante — a ORDEM das seções. Telecom abre com planos porque a
 * dúvida é "quanto custa"; Placas abre com o problema porque a dúvida é "vale
 * a pena". Não é o mesmo template pintado de outra cor.
 *
 * ── O que é preservado da página original ─────────────────────────────────
 * A `ConexaoProductPage` continua intacta em `/conexao-*`. Daqui reaproveitamos
 * apenas dados e integrações: catálogo real de produtos, IDs de vídeo, imagens,
 * FAQ, resolução do consultor, telefone da instância, pixel e tracking.
 */
const ProdutoPremiumPage = () => {
  const location = useLocation();
  const rootRef = useRef<HTMLDivElement>(null);

  // O slug vem do caminho: /premium/conexao-telecom/:licenca → "conexao-telecom"
  const slug = location.pathname.split("/")[2] ?? "";
  const produto = produtoPremiumPorSlug(slug);

  const {
    consultant,
    isLoading,
    licenca,
    isAdsMode,
    waLink,
    cadastroUrl,
    track,
    firstName,
  } = usePremiumConsultant(slug || "produto-premium");

  useReveal(rootRef);

  // Sobe o FAB de WhatsApp para não colidir com o dock no mobile.
  useEffect(() => {
    document.body.classList.add("lpx-has-dock");
    return () => document.body.classList.remove("lpx-has-dock");
  }, []);

  const trackWhatsApp = useCallback(() => track("whatsapp"), [track]);
  const trackCadastro = useCallback(() => track("cadastro"), [track]);

  if (isLoading) return <LoadingScreen />;

  // Slug fora da lista atendida: não inventar página.
  if (!produto) {
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
    return <CanonicalLicenseRedirect paramLicense={licenca} canonicalLicense={consultant.license} />;
  }

  // Em tráfego de anúncio a mensagem carrega a marcação usada pelo bot para
  // classificar a origem do lead. Mesma regra da LP original.
  const prefixo = isAdsMode ? "Oi! Vim do anúncio do Facebook/Instagram. " : "";
  const whatsappUrl = waLink(`${prefixo}${produto.waPrincipal}`);
  const heroVideoId = heroVideoIdDe(produto.slug);

  return (
    <>
      <PixelInjector
        facebookPixelId={consultant.facebook_pixel_id}
        googleAnalyticsId={consultant.google_analytics_id}
      />
      <PremiumHead
        title={`${produto.nome} — ${tituloSeo(produto)} | ${consultant.name}`}
        description={produto.sub}
        consultantName={consultant.name}
        imageUrl={`${window.location.origin}${conexaoPosterUrl(heroVideoId)}`}
      />

      <div ref={rootRef} className="lpx" data-produto={produto.slug}>
        <PremiumSiteNav
          licenca={consultant.license}
          atual={produto.slug}
          ancoras={produto.ancoras}
          whatsappUrl={whatsappUrl}
          ctaLabel={produto.ctaPrincipal}
          onWhatsAppClick={trackWhatsApp}
        />

        <main>
          {/* ═══ HERO ═══ */}
          <section id="top" className="lpx-hero">
            <div className="lpx-hero__glow lpx-hero__glow--accent" aria-hidden="true" />
            <div className="lpx-hero__grid" aria-hidden="true" />

            <div className="lpx-wrap">
              <div className="flex flex-col items-center text-center">
                <p className="lpx-eyebrow lpx-eyebrow--accent">
                  <span className="lpx-eyebrow__dot" aria-hidden="true" />
                  {produto.eyebrow}
                </p>

                <h1 className="lpx-h1 mt-5 max-w-[22ch]">
                  {produto.h1.antes}{" "}
                  <span className="lpx-accent-text">{produto.h1.destaque}</span>
                  {produto.h1.depois ? ` ${produto.h1.depois}` : ""}
                </h1>

                <p className="lpx-lead lpx-measure mt-4 sm:mt-5">{produto.sub}</p>

                <p className="lpx-hero__publico">
                  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <circle cx="12" cy="8" r="3.5" />
                    <path d="M4.5 20a7.5 7.5 0 0 1 15 0" />
                  </svg>
                  {produto.publico}
                </p>

                {/* CTA antes da mídia: quem já se decidiu não precisa rolar. */}
                <div className="lpx-actions mt-7 w-full max-w-[420px] sm:max-w-none">
                  <a
                    href={whatsappUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={trackWhatsApp}
                    className="lpx-btn lpx-btn--wa"
                  >
                    {produto.ctaPrincipal}
                  </a>
                  <a href={produto.ancoras[0]?.href ?? "#solucao"} className="lpx-btn lpx-btn--ghost">
                    {produto.ancoras[0]?.label ?? "Ver detalhes"}
                  </a>
                </div>

                <p className="lpx-body mt-3 !text-[0.8125rem]">{produto.reducaoRisco}</p>

                <div className="lpx-trust mt-7">
                  {produto.confianca.map((item) => (
                    <span key={item.label} className="lpx-trust__item">
                      <svg
                        viewBox="0 0 24 24"
                        width="14"
                        height="14"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2.5"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        className="lpx-accent-text shrink-0"
                        aria-hidden="true"
                      >
                        <path d="M20 6 9 17l-5-5" />
                      </svg>
                      <span className="lpx-trust__label">{item.label}</span>
                      <span className="lpx-trust__detail">{item.detalhe}</span>
                    </span>
                  ))}
                </div>
              </div>

              {/* Vídeo oficial do produto, com autoplay mudo em loop. */}
              <div className="mt-9 md:mt-12 max-w-[900px] mx-auto">
                <AutoplayVideo
                  src={`https://igreen-minio.d9v63q.easypanel.host/igreen/conexao-videos/${heroVideoId}.mp4`}
                  poster={conexaoPosterUrl(heroVideoId)}
                  label={`Apresentação do ${produto.nome}`}
                  className="lpx-video--framed"
                />
              </div>

              {produto.numeros && (
                <div className="lpx-numeros mt-10 md:mt-14 max-w-[720px] mx-auto">
                  {produto.numeros.map((n) => (
                    <div key={n.rotulo} className="lpx-numero">
                      <span className="lpx-numero__v">{n.valor}</span>
                      <span className="lpx-numero__r">{n.rotulo}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </section>

          {/* ═══ SEÇÕES NA ORDEM DEFINIDA PELO PRODUTO ═══ */}
          {produto.ordem.map((bloco) => (
            <BlocoPorNome key={bloco} nome={bloco} p={produto} heroVideoId={heroVideoId} />
          ))}

          {/* ═══ CONSULTOR ═══ */}
          <PremiumConsultantCard
            nome={consultant.name}
            photoUrl={consultant.photo_url}
            igreenId={consultant.igreen_id}
            marca={produto.marca}
            whatsappUrl={whatsappUrl}
            cadastroUrl={cadastroUrl}
            mostrarCadastro={false}
            onWhatsAppClick={trackWhatsApp}
            onCadastroClick={trackCadastro}
            promessas={[
              `Explico o ${produto.nome} sem enrolação`,
              "Mostro os números antes de qualquer contratação",
              "Continuo disponível depois que você fechar",
            ]}
          />

          {/* ═══ FECHAMENTO ═══ */}
          <section className="lpx-section lpx-final">
            <div className="lpx-wrap">
              <div className="text-center max-w-[660px] mx-auto">
                <p className="lpx-eyebrow lpx-eyebrow--accent">
                  <span className="lpx-eyebrow__dot" aria-hidden="true" />
                  Próximo passo
                </p>
                <h2 className="lpx-h2 mt-5">
                  {produto.fechamento.titulo}{" "}
                  <span className="lpx-accent-text">{produto.fechamento.destaque}</span>
                </h2>
                <p className="lpx-lead mt-4">{produto.fechamento.sub}</p>

                <div className="lpx-actions mt-8 max-w-[440px] sm:max-w-none mx-auto">
                  <a
                    href={whatsappUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={trackWhatsApp}
                    className="lpx-btn lpx-btn--wa"
                  >
                    {produto.fechamento.cta}
                  </a>
                  <a
                    href={cadastroUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={trackCadastro}
                    className="lpx-btn lpx-btn--ghost"
                  >
                    Ver todas as soluções
                  </a>
                </div>

                <p className="lpx-body !text-xs mt-5">{produto.fechamento.rodape}</p>
              </div>
            </div>
          </section>

          <footer className="lpx-footer">
            <div className="lpx-wrap">
              <p className="lpx-body !text-xs uppercase tracking-[0.1em] break-words">
                {consultant.name.toUpperCase()} · CONSULTOR(A) {produto.marca.toUpperCase()}
                {consultant.igreen_id ? ` · ID ${consultant.igreen_id}` : ""}
              </p>
              <p className="lpx-footer__legal lpx-measure mx-auto">{produto.legal}</p>
              <p className="lpx-footer__legal">
                <a href="/politica-privacidade" className="lpx-textlink !font-normal">
                  Política de Privacidade
                </a>
              </p>
            </div>
          </footer>
        </main>

        <div className="lpx-dock-spacer" aria-hidden="true" />

        <PremiumDock
          whatsappUrl={whatsappUrl}
          cadastroUrl={cadastroUrl}
          onWhatsAppClick={trackWhatsApp}
          onCadastroClick={trackCadastro}
          rotuloPrincipal={`Falar com ${firstName}`}
          rotuloSecundario={produto.ancoras[0]?.label ?? "Detalhes"}
          hrefSecundario={produto.ancoras[0]?.href}
        />
      </div>

      <WhatsAppFloat url={whatsappUrl} onClickTrack={trackWhatsApp} />
    </>
  );
};

/** Traduz o nome do bloco na seção correspondente. */
function BlocoPorNome({
  nome,
  p,
  heroVideoId,
}: {
  nome: ProdutoPremium["ordem"][number];
  p: ProdutoPremium;
  heroVideoId: string;
}) {
  switch (nome) {
    case "problema":
      return <BlocoProblema p={p} />;
    case "solucao":
      return <BlocoSolucao p={p} heroVideoId={heroVideoId} />;
    case "planos":
      return <BlocoPlanos p={p} />;
    case "passos":
      return <BlocoPassos p={p} />;
    case "destaques":
      return <BlocoDestaques p={p} />;
    case "galeria":
      return <BlocoGaleria p={p} />;
    case "comparacao":
      return <BlocoComparacao p={p} />;
    case "videos":
      return <BlocoVideos p={p} />;
    case "objecoes":
      return <BlocoObjecoes p={p} />;
    case "faq":
      return <BlocoFaq p={p} />;
    default:
      return null;
  }
}

/** Complemento de title por produto, para não repetir SEO entre as páginas. */
function tituloSeo(p: ProdutoPremium): string {
  const mapa: Record<string, string> = {
    "conexao-telecom": "planos 5G a partir de R$ 39,90",
    "conexao-seguros": "proteção veicular a partir de R$ 99/mês",
    "conexao-solar": "energia solar por assinatura com até 20% de desconto",
    "conexao-placas": "energia solar própria com até 95% de economia",
    "conexao-livre": "Mercado Livre de Energia com até 30% de desconto",
    "conexao-club": "descontos em 30 mil lojas no Brasil",
    "conexao-club-pj": "clube de benefícios para empresas",
  };
  return mapa[p.slug] ?? p.marca;
}

export default ProdutoPremiumPage;
