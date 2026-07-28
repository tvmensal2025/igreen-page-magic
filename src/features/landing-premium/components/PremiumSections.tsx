import {
  BENEFITS,
  CASHBACK_MAX_PCT,
  COMPARISON,
  DESCONTO_MAX_PCT,
  HOW_IT_WORKS,
  OBJECTIONS,
  PROBLEMS,
  PROVA_SOCIAL_TEXTO,
  SOLUTION_POINTS,
  STORAGE_VIDEOS,
  TESTIMONIAL_VIDEOS,
  posterFor,
} from "../content";
import { PosterVideo, StaticImage } from "./PremiumMedia";
import { BenefitIcon, ProblemIcon } from "./PremiumIcons";

/* ══════════════════════════════════════════════════════════════
   Identificação com o problema
   ══════════════════════════════════════════════════════════════ */

/**
 * Mostra que entendemos a situação antes de oferecer qualquer coisa.
 * Sem drama inventado: cada item é uma consequência real de não migrar.
 */
export const PremiumProblem = () => (
  <section className="lpx-section">
    <div className="lpx-wrap">
      <div className="max-w-[640px]" data-reveal>
        <p className="lpx-eyebrow">A situação hoje</p>
        <h2 className="lpx-h2 mt-4">
          O problema não é a sua conta ser alta. É ela ser alta{" "}
          <span className="lpx-grad">sem necessidade</span>.
        </h2>
        <p className="lpx-lead mt-3">
          Existe uma fonte de energia mais barata disponível e regulamentada. Quem não migra
          simplesmente continua pagando a mais.
        </p>
      </div>

      <div className="lpx-grid-2 mt-8 md:mt-12">
        {PROBLEMS.map((item) => (
          <article key={item.title} className="lpx-card lpx-card--lift" data-reveal>
            <div className="flex items-start gap-3.5">
              <span className="lpx-icon" aria-hidden="true">
                <ProblemIcon name={item.icon} />
              </span>
              <div className="min-w-0">
                <h3 className="lpx-h3">{item.title}</h3>
                <p className="lpx-body mt-2">{item.body}</p>
              </div>
            </div>
          </article>
        ))}
      </div>
    </div>
  </section>
);

/* ══════════════════════════════════════════════════════════════
   Solução
   ══════════════════════════════════════════════════════════════ */

export const PremiumSolution = () => (
  <section id="solucao" className="lpx-section lpx-section--tint lpx-anchor">
    <div className="lpx-wrap">
      <div className="lpx-split">
        <div data-reveal>
          <p className="lpx-eyebrow">A solução</p>
          <h2 className="lpx-h2 mt-4">Energia solar sem comprar energia solar</h2>
          <p className="lpx-lead mt-3">
            A iGreen Energy tem {PROVA_SOCIAL_TEXTO.fazendas} gerando. Essa energia entra na rede
            da sua distribuidora e o desconto chega até você. O equipamento é nosso; a economia é
            sua.
          </p>

          {/* grid-cols-1 = repeat(1, minmax(0,1fr)): sem isso a coluna
              implícita cresce até o conteúdo e estoura em 320px. */}
          <div className="grid grid-cols-1 gap-3 mt-7">
            {SOLUTION_POINTS.map((point) => (
              <div key={point.title} className="lpx-card !p-4" data-reveal>
                <h3 className="lpx-h3 !text-base">{point.title}</h3>
                <p className="lpx-body mt-1.5">{point.body}</p>
              </div>
            ))}
          </div>
        </div>

        <div className="lpx-split__media" data-reveal>
          <PosterVideo
            src={STORAGE_VIDEOS.casaSustentavel}
            poster="/videos/posters/casasustentavel.webp"
            label="Assistir: como a energia solar chega na sua casa"
          />
          <p className="lpx-body !text-xs text-center mt-3">
            Veja o caminho da energia, da usina até a sua tomada.
          </p>
        </div>
      </div>
    </div>
  </section>
);

/* ══════════════════════════════════════════════════════════════
   Como funciona — 3 passos
   ══════════════════════════════════════════════════════════════ */

export const PremiumHowItWorks = () => (
  <section id="como-funciona" className="lpx-section lpx-anchor">
    <div className="lpx-wrap">
      <div className="text-center max-w-[620px] mx-auto" data-reveal>
        <p className="lpx-eyebrow">Como começar</p>
        <h2 className="lpx-h2 mt-4">Três passos. Nenhum deles é obra.</h2>
        <p className="lpx-lead mt-3">
          Do primeiro contato ao desconto no boleto, tudo acontece pelo celular.
        </p>
      </div>

      <ol className="lpx-grid-3 mt-8 md:mt-12 list-none p-0">
        {HOW_IT_WORKS.map((step) => (
          <li key={step.step} className="lpx-card lpx-card--lift lpx-card--edge" data-reveal>
            <div className="flex items-center gap-3">
              <span className="lpx-step__num" aria-hidden="true">
                {step.step}
              </span>
              <h3 className="lpx-h3">{step.title}</h3>
            </div>
            <p className="lpx-body mt-3">{step.body}</p>
            <p className="lpx-step__meta">
              <svg
                viewBox="0 0 24 24"
                width="13"
                height="13"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.2"
                strokeLinecap="round"
                aria-hidden="true"
              >
                <circle cx="12" cy="12" r="9" />
                <path d="M12 7v5l3 2" />
              </svg>
              {step.meta}
            </p>
          </li>
        ))}
      </ol>
    </div>
  </section>
);

/* ══════════════════════════════════════════════════════════════
   Benefícios
   ══════════════════════════════════════════════════════════════ */

export const PremiumBenefits = () => (
  <section id="beneficios" className="lpx-section lpx-section--tint lpx-anchor">
    <div className="lpx-wrap">
      <div className="text-center max-w-[640px] mx-auto" data-reveal>
        <p className="lpx-eyebrow">O que você ganha</p>
        <h2 className="lpx-h2 mt-4">Não é só desconto na luz</h2>
        <p className="lpx-lead mt-3">
          Cada item aqui é um recurso real do Conexão Green — e o que ele muda na prática.
        </p>
      </div>

      <div className="lpx-grid-3 mt-8 md:mt-12">
        {BENEFITS.map((benefit) => (
          <article key={benefit.title} className="lpx-card lpx-card--lift" data-reveal>
            <span className="lpx-icon" aria-hidden="true">
              <BenefitIcon name={benefit.icon} />
            </span>
            <h3 className="lpx-h3 mt-4">{benefit.title}</h3>
            <p className="lpx-body mt-2">{benefit.body}</p>
          </article>
        ))}
      </div>
    </div>
  </section>
);

/* ══════════════════════════════════════════════════════════════
   Cashback — como zerar a conta
   ══════════════════════════════════════════════════════════════ */

export const PremiumCashback = () => (
  <section className="lpx-section">
    <div className="lpx-wrap">
      <div className="lpx-split lpx-split--media-first">
        <div className="lpx-split__media" data-reveal>
          <PosterVideo
            src={STORAGE_VIDEOS.cashback}
            poster="/videos/posters/cash-back-igreen.webp"
            label="Assistir: como funciona o Cashback Sustentável"
          />
        </div>

        <div data-reveal>
          <p className="lpx-eyebrow">Cashback Sustentável</p>
          <h2 className="lpx-h2 mt-4">
            Dá para chegar a{" "}
            <span className="lpx-grad">zerar sua conta de luz</span>
          </h2>
          <p className="lpx-lead mt-3">
            Indique alguém. Se o cadastro for aprovado, você passa a receber até{" "}
            {CASHBACK_MAX_PCT}% de cashback sobre o boleto iGreen dessa pessoa — abatido
            automaticamente no seu próximo boleto.
          </p>

          <div className="lpx-card lpx-card--edge mt-6">
            <p className="lpx-body !text-[0.8125rem] font-semibold !text-[hsl(var(--foreground))]">
              Exemplo com números da própria mecânica
            </p>
            <p className="lpx-body mt-2">
              Você indica um cliente com conta de R$ 500. São contabilizados até R$ 10 de
              cashback por mês, descontados do seu boleto. Quanto mais indicações aprovadas,
              mais o seu valor cai — até chegar a zero.
            </p>
          </div>

          <p className="lpx-body !text-xs mt-4">
            O cashback é calculado sobre o boleto iGreen do cliente indicado e depende da
            aprovação do cadastro dele.
          </p>
        </div>
      </div>
    </div>
  </section>
);

/* ══════════════════════════════════════════════════════════════
   iGreen Club
   ══════════════════════════════════════════════════════════════ */

export const PremiumClub = () => (
  <section className="lpx-section lpx-section--tint">
    <div className="lpx-wrap">
      <div className="text-center max-w-[640px] mx-auto" data-reveal>
        <p className="lpx-eyebrow">Incluído</p>
        <h2 className="lpx-h2 mt-4">iGreen Club, sem pagar nada a mais</h2>
        <p className="lpx-lead mt-3">
          Descontos em mais de 600 mil produtos e serviços, em 60 mil lojas parceiras no Brasil.
          Liberado para clientes ativos.
        </p>
      </div>

      <div className="mt-8 md:mt-12 max-w-[880px] mx-auto" data-reveal>
        <StaticImage
          src="/images/lojas-parceiras.png"
          alt="Marcas parceiras do iGreen Club, entre elas Pague Menos, Casas Bahia, Netshoes, Movida, Vivara, Magalu e Cinemark"
          width={1200}
          height={675}
        />
      </div>

      <div className="lpx-grid-2 mt-6 max-w-[880px] mx-auto">
        <div className="lpx-card" data-reveal>
          <h3 className="lpx-h3">Economia que sai da conta de luz</h3>
          <p className="lpx-body mt-2">
            Farmácia, supermercado, moda, pet, óculos, locadora, cinema. O desconto passa a
            valer em compras que você já faz todo mês.
          </p>
        </div>
        <div className="lpx-card" data-reveal>
          <h3 className="lpx-h3">Sem mensalidade de clube</h3>
          <p className="lpx-body mt-2">
            O acesso é um benefício de ser cliente iGreen. Não existe assinatura separada nem
            cobrança adicional para usar.
          </p>
        </div>
      </div>
    </div>
  </section>
);

/* ══════════════════════════════════════════════════════════════
   Comparação
   ══════════════════════════════════════════════════════════════ */

export const PremiumComparison = () => (
  <section className="lpx-section">
    <div className="lpx-wrap">
      <div className="text-center max-w-[600px] mx-auto" data-reveal>
        <p className="lpx-eyebrow">Lado a lado</p>
        <h2 className="lpx-h2 mt-4">A diferença é só uma decisão</h2>
      </div>

      <div className="lpx-vs mt-8 md:mt-12 max-w-[900px] mx-auto">
        <div className="lpx-vs__col lpx-vs__col--before" data-reveal>
          <h3 className="lpx-vs__title">{COMPARISON.before.title}</h3>
          <ul className="lpx-vs__list">
            {COMPARISON.before.items.map((item) => (
              <li key={item} className="lpx-vs__item">
                <svg
                  viewBox="0 0 24 24"
                  width="16"
                  height="16"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.4"
                  strokeLinecap="round"
                  className="lpx-vs__mark lpx-vs__mark--no"
                  aria-hidden="true"
                >
                  <path d="M18 6 6 18M6 6l12 12" />
                </svg>
                <span className="lpx-body !text-sm">{item}</span>
              </li>
            ))}
          </ul>
        </div>

        <div className="lpx-vs__col lpx-vs__col--after" data-reveal>
          <h3 className="lpx-vs__title">
            <span className="lpx-eyebrow__dot" aria-hidden="true" />
            {COMPARISON.after.title}
          </h3>
          <ul className="lpx-vs__list">
            {COMPARISON.after.items.map((item) => (
              <li key={item} className="lpx-vs__item">
                <svg
                  viewBox="0 0 24 24"
                  width="16"
                  height="16"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.6"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="lpx-vs__mark lpx-vs__mark--yes"
                  aria-hidden="true"
                >
                  <path d="M20 6 9 17l-5-5" />
                </svg>
                <span className="lpx-body !text-sm !text-[hsl(var(--foreground))]">{item}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  </section>
);

/* ══════════════════════════════════════════════════════════════
   Prova — depoimentos + credibilidade
   ══════════════════════════════════════════════════════════════ */

export const PremiumProof = () => (
  <section id="prova" className="lpx-section lpx-section--tint lpx-anchor">
    <div className="lpx-wrap">
      <div className="text-center max-w-[640px] mx-auto" data-reveal>
        <p className="lpx-eyebrow">Prova</p>
        <h2 className="lpx-h2 mt-4">Quem já migrou, falando por conta própria</h2>
        <p className="lpx-lead mt-3">
          Depoimentos gravados por clientes iGreen. Toque para assistir — os vídeos só carregam
          quando você pede.
        </p>
      </div>

      <div className="lpx-vids mt-8 md:mt-12 max-w-[1000px] mx-auto" data-reveal>
        {TESTIMONIAL_VIDEOS.map((src, index) => (
          <PosterVideo
            key={src}
            src={src}
            poster={posterFor(src)}
            label={`Assistir depoimento ${index + 1} de cliente iGreen`}
            variant="tile"
          />
        ))}
      </div>

      <div className="lpx-grid-3 mt-8 max-w-[900px] mx-auto">
        <div className="lpx-card !p-4 text-center" data-reveal>
          <p className="lpx-h3 !text-base">Selo RA1000</p>
          <p className="lpx-body mt-1.5 !text-[0.8125rem]">
            Nível mais alto de reputação de atendimento no Reclame Aqui.
          </p>
        </div>
        <div className="lpx-card !p-4 text-center" data-reveal>
          <p className="lpx-h3 !text-base">700 mil+ clientes</p>
          <p className="lpx-body mt-1.5 !text-[0.8125rem]">
            Empresa mineira fundada em 2021, em Uberlândia (MG).
          </p>
        </div>
        <div className="lpx-card !p-4 text-center" data-reveal>
          <p className="lpx-h3 !text-base">Lei 14.300/2022</p>
          <p className="lpx-body mt-1.5 !text-[0.8125rem]">
            Atividade regulamentada por lei federal.
          </p>
        </div>
      </div>
    </div>
  </section>
);

/* ══════════════════════════════════════════════════════════════
   Quebra de objeções
   ══════════════════════════════════════════════════════════════ */

export const PremiumObjections = () => (
  <section className="lpx-section">
    <div className="lpx-wrap">
      <div className="text-center max-w-[600px] mx-auto" data-reveal>
        <p className="lpx-eyebrow">Direto ao ponto</p>
        <h2 className="lpx-h2 mt-4">As oito perguntas que todo mundo faz</h2>
      </div>

      <dl className="lpx-grid-2 mt-8 md:mt-12">
        {OBJECTIONS.map((item) => (
          <div key={item.q} className="lpx-card" data-reveal>
            <dt className="lpx-h3 !text-base flex items-start gap-2.5">
              <svg
                viewBox="0 0 24 24"
                width="17"
                height="17"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.4"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="text-[hsl(var(--primary-text))] shrink-0 mt-0.5"
                aria-hidden="true"
              >
                <path d="M20 6 9 17l-5-5" />
              </svg>
              <span>{item.q}</span>
            </dt>
            <dd className="lpx-body mt-2 ml-[27px]">{item.a}</dd>
          </div>
        ))}
      </dl>

      <div className="mt-10 max-w-[880px] mx-auto" data-reveal>
        <PosterVideo
          src={STORAGE_VIDEOS.club}
          poster="/videos/posters/club-de-beneficios.webp"
          label="Assistir: clube de benefícios iGreen"
        />
      </div>
    </div>
  </section>
);

/* ══════════════════════════════════════════════════════════════
   Cobertura
   ══════════════════════════════════════════════════════════════ */

export const PremiumCoverage = () => (
  <section className="lpx-section lpx-section--tint">
    <div className="lpx-wrap">
      <div className="lpx-split">
        <div data-reveal>
          <p className="lpx-eyebrow">Cobertura</p>
          <h2 className="lpx-h2 mt-4">Presença em 27 estados</h2>
          <p className="lpx-lead mt-3">
            A iGreen Energy atende praticamente todo o território nacional. A confirmação de
            disponibilidade é feita pelo seu endereço de consumo, na análise da fatura.
          </p>
          <div className="lpx-card !p-4 mt-6">
            <p className="lpx-body">
              Atendemos casas, apartamentos, prédios, condomínios, fazendas, comércios e
              empresas. Se existe conta de luz no seu nome ou no da empresa, vale conferir.
            </p>
          </div>
          <p className="lpx-body !text-xs mt-4">
            A disponibilidade depende da distribuidora que atende o seu endereço. O consultor
            confirma antes de qualquer cadastro.
          </p>
        </div>

        <div className="lpx-split__media" data-reveal>
          <StaticImage
            src="/images/imagem-3.jpeg"
            alt="Mapa do Brasil destacando os estados atendidos pela iGreen Energy"
            width={900}
            height={900}
          />
        </div>
      </div>
    </div>
  </section>
);

export const PREMIUM_DISCOUNT_LABEL = `${DESCONTO_MAX_PCT}%`;
