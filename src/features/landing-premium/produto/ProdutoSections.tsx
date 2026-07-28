import { conexaoPosterUrl, conexaoVideoUrl } from "@/lib/conexaoVideos";
import AutoplayVideo from "../shared/AutoplayVideo";
import Icon from "../components/PremiumIcons";
import type { ProdutoPremium } from "./productPremium";

/**
 * Seções da LP premium de produto.
 *
 * Todas recebem o objeto `p` (configuração do produto) e leem apenas o bloco
 * que lhes interessa. Quem decide o que aparece e em que ordem é `p.ordem`, na
 * página — então dois produtos podem usar as mesmas seções em sequências
 * diferentes sem código condicional espalhado.
 */

/* ── Cabeçalho reaproveitado ─────────────────────────────────── */

function Cabecalho({
  eyebrow,
  titulo,
  destaque,
  intro,
  centralizado = true,
}: {
  eyebrow: string;
  titulo: string;
  destaque?: string;
  intro?: string;
  centralizado?: boolean;
}) {
  return (
    <div
      className={centralizado ? "text-center max-w-[660px] mx-auto" : "max-w-[660px]"}
      data-reveal
    >
      <p className="lpx-eyebrow lpx-eyebrow--accent">{eyebrow}</p>
      <h2 className="lpx-h2 mt-4">
        {titulo}
        {destaque && (
          <>
            {" "}
            <span className="lpx-accent-text">{destaque}</span>
          </>
        )}
      </h2>
      {intro && <p className="lpx-lead mt-3">{intro}</p>}
    </div>
  );
}

/* ── Problema ────────────────────────────────────────────────── */

export function BlocoProblema({ p }: { p: ProdutoPremium }) {
  if (!p.problema) return null;
  const { eyebrow, titulo, destaque, intro, itens } = p.problema;

  return (
    <section id="problema" className="lpx-section lpx-anchor">
      <div className="lpx-wrap">
        <Cabecalho
          eyebrow={eyebrow}
          titulo={titulo}
          destaque={destaque}
          intro={intro}
          centralizado={false}
        />
        <div className="lpx-grid-2 mt-8 md:mt-12">
          {itens.map((item) => (
            <article key={item.t} className="lpx-card lpx-card--lift" data-reveal>
              <h3 className="lpx-h3">{item.t}</h3>
              <p className="lpx-body mt-2">{item.b}</p>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ── Solução ─────────────────────────────────────────────────── */

export function BlocoSolucao({ p, heroVideoId }: { p: ProdutoPremium; heroVideoId: string }) {
  if (!p.solucao) return null;
  const { eyebrow, titulo, intro, pontos } = p.solucao;

  return (
    <section id="solucao" className="lpx-section lpx-section--tint lpx-anchor">
      <div className="lpx-wrap">
        <div className="lpx-split">
          <div data-reveal>
            <p className="lpx-eyebrow lpx-eyebrow--accent">{eyebrow}</p>
            <h2 className="lpx-h2 mt-4">{titulo}</h2>
            <p className="lpx-lead mt-3">{intro}</p>

            <div className="grid grid-cols-1 gap-3 mt-7">
              {pontos.map((ponto) => (
                <div key={ponto.t} className="lpx-card !p-4" data-reveal>
                  <h3 className="lpx-h3 !text-base">{ponto.t}</h3>
                  <p className="lpx-body mt-1.5">{ponto.b}</p>
                </div>
              ))}
            </div>
          </div>

          {/* Reaproveita o vídeo do hero do catálogo: é o material oficial do
              produto. Aqui sem autoplay — quem chegou até esta altura escolhe
              se quer assistir, e evitamos dois vídeos disputando banda. */}
          <div className="lpx-split__media" data-reveal>
            <AutoplayVideo
              src={conexaoVideoUrl(heroVideoId)}
              poster={conexaoPosterUrl(heroVideoId)}
              label={`Apresentação do ${p.nome}`}
              autoplay={false}
              className="lpx-video--framed"
            />
          </div>
        </div>
      </div>
    </section>
  );
}

/* ── Planos ──────────────────────────────────────────────────── */

export function BlocoPlanos({ p }: { p: ProdutoPremium }) {
  if (!p.planos) return null;
  const { eyebrow, titulo, intro, lista, nota } = p.planos;

  return (
    <section id="planos" className="lpx-section lpx-anchor">
      <div className="lpx-wrap">
        <Cabecalho eyebrow={eyebrow} titulo={titulo} intro={intro} />

        <div className="lpx-grid-3 mt-8 md:mt-12">
          {lista.map((plano) => (
            <article
              key={plano.nome}
              className="lpx-plano"
              data-destaque={plano.destaque ? "true" : undefined}
              data-reveal
            >
              {plano.destaque && <span className="lpx-plano__selo">Mais procurado</span>}
              <h3 className="lpx-h3">{plano.nome}</h3>
              <p className="lpx-plano__resumo">{plano.resumo}</p>
              <ul className="lpx-plano__itens">
                {plano.itens.map((item) => (
                  <li key={item}>
                    <svg
                      viewBox="0 0 24 24"
                      width="15"
                      height="15"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2.6"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      aria-hidden="true"
                    >
                      <path d="M20 6 9 17l-5-5" />
                    </svg>
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </article>
          ))}
        </div>

        {nota && (
          <p className="lpx-body !text-xs text-center mt-6 lpx-measure mx-auto" data-reveal>
            {nota}
          </p>
        )}
      </div>
    </section>
  );
}

/* ── Passos ──────────────────────────────────────────────────── */

export function BlocoPassos({ p }: { p: ProdutoPremium }) {
  if (!p.passos) return null;
  const { eyebrow, titulo, intro, lista } = p.passos;

  return (
    <section id="passos" className="lpx-section lpx-section--tint lpx-anchor">
      <div className="lpx-wrap">
        <Cabecalho eyebrow={eyebrow} titulo={titulo} intro={intro} />

        <ol className="lpx-grid-3 mt-8 md:mt-12 list-none p-0">
          {lista.map((passo) => (
            <li key={passo.n} className="lpx-card lpx-card--lift lpx-card--edge" data-reveal>
              <div className="flex items-center gap-3">
                <span className="lpx-step__num lpx-step__num--accent" aria-hidden="true">
                  {passo.n}
                </span>
                <h3 className="lpx-h3">{passo.t}</h3>
              </div>
              <p className="lpx-body mt-3">{passo.b}</p>
              <p className="lpx-step__meta lpx-accent-text">
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
                {passo.meta}
              </p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

/* ── Destaques ───────────────────────────────────────────────── */

export function BlocoDestaques({ p }: { p: ProdutoPremium }) {
  if (!p.destaques) return null;
  const { eyebrow, titulo, intro, lista } = p.destaques;

  return (
    <section id="destaques" className="lpx-section lpx-anchor">
      <div className="lpx-wrap">
        <Cabecalho eyebrow={eyebrow} titulo={titulo} intro={intro} />

        <div className="lpx-grid-3 mt-8 md:mt-12">
          {lista.map((d) => (
            <article key={d.t} className="lpx-card lpx-card--lift" data-reveal>
              <span className="lpx-icon lpx-icon--accent" aria-hidden="true">
                <Icon name={d.icone} />
              </span>
              <h3 className="lpx-h3 mt-4">{d.t}</h3>
              <p className="lpx-body mt-2">{d.b}</p>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ── Galeria ─────────────────────────────────────────────────── */

export function BlocoGaleria({ p }: { p: ProdutoPremium }) {
  if (!p.galeria || p.galeria.imagens.length === 0) return null;
  const { titulo, intro, imagens, formato, altBase } = p.galeria;

  return (
    <section id="galeria" className="lpx-section lpx-section--tint lpx-anchor">
      <div className="lpx-wrap">
        <Cabecalho eyebrow="Veja de perto" titulo={titulo} intro={intro} />

        <div className="lpx-galeria" data-formato={formato} data-reveal>
          {imagens.map((src, i) => (
            <figure key={src} className="lpx-galeria__item">
              <img
                src={src}
                alt={`${altBase} ${i + 1}`}
                loading="lazy"
                decoding="async"
                {...{ fetchpriority: "low" }}
              />
            </figure>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ── Comparação ──────────────────────────────────────────────── */

export function BlocoComparacao({ p }: { p: ProdutoPremium }) {
  if (!p.comparacao) return null;
  const { eyebrow, titulo, antes, depois } = p.comparacao;

  return (
    <section id="comparacao" className="lpx-section lpx-anchor">
      <div className="lpx-wrap">
        <Cabecalho eyebrow={eyebrow} titulo={titulo} />

        <div className="lpx-vs mt-8 md:mt-12 max-w-[900px] mx-auto">
          <div className="lpx-vs__col lpx-vs__col--before" data-reveal>
            <h3 className="lpx-vs__title">{antes.titulo}</h3>
            <ul className="lpx-vs__list">
              {antes.itens.map((item) => (
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

          <div className="lpx-vs__col lpx-vs__col--after lpx-vs__col--accent" data-reveal>
            <h3 className="lpx-vs__title">
              <span className="lpx-eyebrow__dot" aria-hidden="true" />
              {depois.titulo}
            </h3>
            <ul className="lpx-vs__list">
              {depois.itens.map((item) => (
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
                    className="lpx-vs__mark lpx-accent-text"
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
}

/* ── Vídeos ──────────────────────────────────────────────────── */

export function BlocoVideos({ p }: { p: ProdutoPremium }) {
  if (!p.videos || p.videos.lista.length === 0) return null;
  const { eyebrow, titulo, intro, lista } = p.videos;

  return (
    <section id="videos" className="lpx-section lpx-section--tint lpx-anchor">
      <div className="lpx-wrap">
        <Cabecalho eyebrow={eyebrow} titulo={titulo} intro={intro} />

        <div
          className={`mt-8 md:mt-12 mx-auto ${
            lista.length > 1 ? "lpx-grid-2 max-w-[1000px]" : "max-w-[820px]"
          }`}
        >
          {lista.map((v) => (
            <div key={v.id} data-reveal>
              {/* Sem autoplay: são vídeos de apoio, abaixo da dobra. Carregam
                  só quando a pessoa pede — nenhum MP4 desnecessário. */}
              <AutoplayVideo
                src={conexaoVideoUrl(v.id)}
                poster={conexaoPosterUrl(v.id)}
                label={v.titulo}
                autoplay={false}
              />
              <p className="lpx-h3 !text-base mt-3">{v.titulo}</p>
              {v.sub && <p className="lpx-body !text-[0.8125rem] mt-1">{v.sub}</p>}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ── Objeções ────────────────────────────────────────────────── */

export function BlocoObjecoes({ p }: { p: ProdutoPremium }) {
  if (!p.objecoes) return null;
  const { eyebrow, titulo, lista } = p.objecoes;

  return (
    <section id="objecoes" className="lpx-section lpx-anchor">
      <div className="lpx-wrap">
        <Cabecalho eyebrow={eyebrow} titulo={titulo} />

        <dl className="lpx-grid-2 mt-8 md:mt-12">
          {lista.map((item) => (
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
                  className="lpx-accent-text shrink-0 mt-0.5"
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
      </div>
    </section>
  );
}

/* ── FAQ ─────────────────────────────────────────────────────── */

export function BlocoFaq({ p }: { p: ProdutoPremium }) {
  if (!p.faq || p.faq.lista.length === 0) return null;
  const { eyebrow, titulo, intro, lista } = p.faq;

  return (
    <section id="faq" className="lpx-section lpx-section--tint lpx-anchor">
      <div className="lpx-wrap">
        <Cabecalho eyebrow={eyebrow} titulo={titulo} intro={intro} />

        <div className="lpx-faq mt-8 md:mt-10 max-w-[760px] mx-auto" data-reveal>
          {lista.map((item) => (
            <details key={item.q} className="lpx-faq__item">
              <summary className="lpx-faq__q">
                <span>{item.q}</span>
                <svg
                  viewBox="0 0 24 24"
                  width="18"
                  height="18"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.4"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="lpx-faq__chev lpx-accent-text"
                  aria-hidden="true"
                >
                  <path d="m6 9 6 6 6-6" />
                </svg>
              </summary>
              <p className="lpx-faq__a">{item.a}</p>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}
