import { HERO_STATS, TRUST_ITEMS, DESCONTO_MAX_PCT } from "../content";
import AutoplayVideo from "../shared/AutoplayVideo";

interface PremiumHeroProps {
  whatsappUrl: string;
  cadastroUrl: string;
  onWhatsAppClick: () => void;
  onCadastroClick: () => void;
}

/**
 * Primeira dobra.
 *
 * Ordem no mobile pensada para decisão rápida: selo → título → subtítulo →
 * CTA → prova → mídia. O botão principal aparece antes do vídeo, porque quem
 * já se decidiu no título não deveria ter que rolar para agir.
 *
 * Performance: o vídeo entra como poster `.webp` (imagem leve). Nada de MP4 no
 * carregamento inicial e nada de autoplay.
 */
const PremiumHero = ({
  whatsappUrl,
  cadastroUrl,
  onWhatsAppClick,
  onCadastroClick,
}: PremiumHeroProps) => (
  <section id="top" className="lpx-hero">
    <div className="lpx-hero__glow" aria-hidden="true" />
    <div className="lpx-hero__grid" aria-hidden="true" />

    <div className="lpx-wrap">
      <div className="flex flex-col items-center text-center">
        <p className="lpx-eyebrow">
          <span className="lpx-eyebrow__dot" aria-hidden="true" />
          Conexão Green · iGreen Energy
        </p>

        <h1 className="lpx-h1 mt-5 max-w-[19ch]">
          Sua conta de luz até{" "}
          <span className="lpx-grad">{DESCONTO_MAX_PCT}% mais barata</span>, todo mês
        </h1>

        <p className="lpx-lead lpx-measure mt-4 sm:mt-5">
          Energia solar por assinatura. A luz continua chegando pela mesma distribuidora — muda
          só quem gera. Sem instalar placas, sem obra e sem pagar nada para participar.
        </p>

        {/* CTA antes da mídia: quem já decidiu não precisa rolar.
            O teto de 420px vale só no celular; acima disso os botões voltam ao
            tamanho do texto e ficam centralizados. */}
        <div className="lpx-actions mt-7 w-full max-w-[420px] sm:max-w-none">
          <a
            href={whatsappUrl}
            target="_blank"
            rel="noopener noreferrer"
            onClick={onWhatsAppClick}
            className="lpx-btn lpx-btn--wa"
          >
            Quero saber meu desconto
          </a>
          <a
            href="#simulador"
            className="lpx-btn lpx-btn--ghost"
          >
            Simular economia
          </a>
        </div>

        <p className="lpx-body mt-3 !text-[0.8125rem]">
          Análise gratuita a partir de uma foto da sua conta de luz.
        </p>

        <div className="lpx-trust mt-7">
          {TRUST_ITEMS.map((item) => (
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
                className="text-[hsl(var(--primary-text))] shrink-0"
                aria-hidden="true"
              >
                <path d="M20 6 9 17l-5-5" />
              </svg>
              <span className="lpx-trust__label">{item.label}</span>
              <span className="lpx-trust__detail">{item.detail}</span>
            </span>
          ))}
        </div>
      </div>

      {/* Vídeo com autoplay real (mudo, em loop). Começa como poster leve e só
          baixa o MP4 quando entra na tela e o navegador está ocioso — em
          conexão econômica vira clique-para-tocar. Ver AutoplayVideo. */}
      <div className="mt-9 md:mt-12 max-w-[900px] mx-auto">
        <AutoplayVideo
          src="/videos/Green_Energy.mp4"
          poster="/videos/posters/Green_Energy.webp"
          label="Como funciona a energia solar por assinatura da iGreen Energy"
          className="lpx-video--framed"
        />
      </div>

      <div className="lpx-stats mt-10 md:mt-14 max-w-[720px] mx-auto">
        {HERO_STATS.map((stat) => (
          <div key={stat.label} className="lpx-stat">
            {/* Número estático: contador animado obrigaria JS + reflow na
                primeira dobra. O valor importa mais que a animação. */}
            <span className="lpx-stat__num">
              {stat.value.toLocaleString("pt-BR")}
              {stat.suffix}
            </span>
            <span className="lpx-stat__label">{stat.label}</span>
          </div>
        ))}
      </div>

      {/* Cadastro direto para quem já conhece e não quer conversar antes. */}
      <p className="text-center lpx-body mt-8">
        Já conhece e quer aderir?{" "}
        <a
          href={cadastroUrl}
          target="_blank"
          rel="noopener noreferrer"
          onClick={onCadastroClick}
          className="lpx-textlink"
        >
          Fazer o cadastro online
        </a>
      </p>
    </div>
  </section>
);

export default PremiumHero;
