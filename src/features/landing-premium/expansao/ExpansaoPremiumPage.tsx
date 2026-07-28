import { useCallback, useEffect, useRef } from "react";

import LoadingScreen from "@/components/LoadingScreen";
import PageStatus from "@/components/common/PageStatus";
import PixelInjector from "@/components/PixelInjector";
import WhatsAppFloat from "@/components/WhatsAppFloat";
import { CanonicalLicenseRedirect } from "@/components/common/CanonicalLicenseRedirect";

import "../premium.css";
import PremiumHead from "../PremiumHead";
import { useReveal } from "../useReveal";
import PremiumSiteNav from "../shared/PremiumSiteNav";
import PremiumDock from "../components/PremiumDock";
import AutoplayVideo from "../shared/AutoplayVideo";
import Icon from "../components/PremiumIcons";
import { PremiumConsultantCard } from "../shared/PremiumConsultantCard";
import { usePremiumConsultant } from "../shared/usePremiumConsultant";
import { PROVA_SOCIAL, PROVA_SOCIAL_TEXTO } from "../content";
import {
  ANCORAS_EXPANSAO,
  IMAGENS_EXPANSAO,
  LEGAL_EXPANSAO,
  LICENCA_INCLUI,
  MECANICA_EQUIPE,
  NIVEIS_CARREIRA,
  OBJECOES_EXPANSAO,
  PARA_QUEM,
  PASSOS_EXPANSAO,
  PRODUTOS_PARA_VENDER,
  VIDEO_EXPANSAO,
} from "./expansaoContent";

/**
 * LP premium da Expansão (ser Licenciado iGreen).
 *
 * Rota: `/premium/expansao/:licenca`. A original (`/licenciado/:licenca`)
 * continua intacta.
 *
 * ── O que mudou em relação à original ─────────────────────────────────────
 * A página original tem 20 seções, uma por produto, e chega ao plano de
 * carreira no fim — depois de dois banners de urgência ("dinheiro que você
 * deixa na mesa"). Aqui a ordem foi invertida em torno da pergunta real de
 * quem avalia uma oportunidade: o que eu vendo, quanto eu ganho, o que eu
 * recebo para começar, quais são os riscos.
 *
 * ── Postura sobre renda ───────────────────────────────────────────────────
 * Os valores do plano de carreira são preservados exatamente como estão no
 * projeto, mas rotulados pelo que são: bônus de qualificação atrelados a metas
 * de kWh. Há aviso explícito de que não há garantia de ganho. Persuadir aqui é
 * deixar a mecânica clara, não sugerir renda fácil.
 */
const ExpansaoPremiumPage = () => {
  const rootRef = useRef<HTMLDivElement>(null);

  const { consultant, isLoading, licenca, isAdsMode, waLink, track, firstName } =
    usePremiumConsultant("expansao-premium");

  useReveal(rootRef);

  useEffect(() => {
    document.body.classList.add("lpx-has-dock");
    return () => document.body.classList.remove("lpx-has-dock");
  }, []);

  const trackWhatsApp = useCallback(() => track("whatsapp"), [track]);
  const trackCadastro = useCallback(() => track("cadastro"), [track]);

  if (isLoading) return <LoadingScreen />;

  if (!consultant) {
    return (
      <PageStatus
        title="Licenciado não encontrado"
        description="Verifique o link e tente novamente. A página é pública — o endereço precisa terminar com a licença (ex.: /premium/expansao/sua-licenca)."
      />
    );
  }

  if (licenca && consultant.license && licenca !== consultant.license) {
    return <CanonicalLicenseRedirect paramLicense={licenca} canonicalLicense={consultant.license} />;
  }

  const prefixo = isAdsMode ? "Oi! Vim do anúncio do Facebook/Instagram. " : "Olá! ";
  const whatsappUrl = waLink(
    `${prefixo}Quero entender como funciona a licença iGreen Energy e o plano de carreira.`,
  );

  // A Expansão tem URL de cadastro própria; cai na geral se não houver.
  const cadastroUrl =
    consultant.licenciada_cadastro_url ||
    consultant.cadastro_url ||
    "https://digital.igreenenergy.com.br/?sendcontract=true";

  return (
    <>
      <PixelInjector
        facebookPixelId={consultant.facebook_pixel_id}
        googleAnalyticsId={consultant.google_analytics_id}
      />
      <PremiumHead
        title={`Seja Licenciado iGreen Energy — 9 produtos e comissão recorrente | ${consultant.name}`}
        description="Entenda a licença iGreen Energy: 9 produtos para vender, comissão recorrente sobre o consumo dos clientes e plano de carreira por kWh acumulado. Sem promessa de renda — só a mecânica, explicada."
        consultantName={consultant.name}
      />

      <div ref={rootRef} className="lpx" data-produto="conexao-expansao">
        <PremiumSiteNav
          licenca={consultant.license}
          atual="conexao-expansao"
          ancoras={ANCORAS_EXPANSAO}
          whatsappUrl={whatsappUrl}
          ctaLabel="Falar sobre a licença"
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
                  Conexão Expansão · Licença iGreen Energy
                </p>

                <h1 className="lpx-h1 mt-5 max-w-[21ch]">
                  Venda energia, telecom, seguros e clube com{" "}
                  <span className="lpx-accent-text">comissão recorrente</span>
                </h1>

                <p className="lpx-lead lpx-measure mt-4 sm:mt-5">
                  A licença iGreen dá acesso a 9 produtos, treinamento, aplicativo e suporte. A
                  comissão da energia é calculada sobre o consumo do cliente — enquanto ele for
                  cliente.
                </p>

                <p className="lpx-hero__publico">
                  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <circle cx="12" cy="8" r="3.5" />
                    <path d="M4.5 20a7.5 7.5 0 0 1 15 0" />
                  </svg>
                  Para quem quer vender sem trocar de profissão
                </p>

                <div className="lpx-actions mt-7 w-full max-w-[420px] sm:max-w-none">
                  <a
                    href={whatsappUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={trackWhatsApp}
                    className="lpx-btn lpx-btn--wa"
                  >
                    Quero entender a licença
                  </a>
                  <a href="#carreira" className="lpx-btn lpx-btn--ghost">
                    Ver o plano de carreira
                  </a>
                </div>

                <p className="lpx-body mt-3 !text-[0.8125rem]">
                  Conversa sem compromisso. Nenhum número desta página é promessa de renda.
                </p>

                <div className="lpx-trust mt-7">
                  {[
                    { label: "9 produtos", detalhe: "na mesma licença" },
                    { label: "Comissão recorrente", detalhe: "sobre o consumo" },
                    { label: "Treinamento incluído", detalhe: "iGreen Academy" },
                    { label: "27 estados", detalhe: "de atuação" },
                  ].map((item) => (
                    <span key={item.label} className="lpx-trust__item">
                      <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="lpx-accent-text shrink-0" aria-hidden="true">
                        <path d="M20 6 9 17l-5-5" />
                      </svg>
                      <span className="lpx-trust__label">{item.label}</span>
                      <span className="lpx-trust__detail">{item.detalhe}</span>
                    </span>
                  ))}
                </div>
              </div>

              <div className="mt-9 md:mt-12 max-w-[900px] mx-auto">
                <AutoplayVideo
                  src={VIDEO_EXPANSAO}
                  poster="/videos/posters/igreen-energy.webp"
                  label="Imagine ser um licenciado iGreen Energy"
                  className="lpx-video--framed"
                />
              </div>

              <div className="lpx-numeros mt-10 md:mt-14 max-w-[720px] mx-auto">
                <div className="lpx-numero">
                  <span className="lpx-numero__v">
                    {PROVA_SOCIAL.clientes.valor}
                    {PROVA_SOCIAL.clientes.sufixo}
                  </span>
                  <span className="lpx-numero__r">clientes ativos na base</span>
                </div>
                <div className="lpx-numero">
                  <span className="lpx-numero__v">
                    {PROVA_SOCIAL.fazendas.valor}
                    {PROVA_SOCIAL.fazendas.sufixo}
                  </span>
                  <span className="lpx-numero__r">fazendas solares</span>
                </div>
                <div className="lpx-numero">
                  <span className="lpx-numero__v">9</span>
                  <span className="lpx-numero__r">produtos para vender</span>
                </div>
              </div>
            </div>
          </section>

          {/* ═══ PARA QUEM ═══ */}
          <section className="lpx-section">
            <div className="lpx-wrap">
              <div className="max-w-[660px]" data-reveal>
                <p className="lpx-eyebrow lpx-eyebrow--accent">Perfil</p>
                <h2 className="lpx-h2 mt-4">
                  Isso faz sentido para{" "}
                  <span className="lpx-accent-text">quem já conversa com gente</span>
                </h2>
                <p className="lpx-lead mt-3">
                  Não é uma vaga de emprego e não exige experiência em energia. É uma licença
                  comercial: você passa a ter produtos para oferecer e uma estrutura para apoiar.
                </p>
              </div>

              <div className="lpx-grid-2 mt-8 md:mt-12">
                {PARA_QUEM.map((item) => (
                  <article key={item.t} className="lpx-card lpx-card--lift" data-reveal>
                    <h3 className="lpx-h3">{item.t}</h3>
                    <p className="lpx-body mt-2">{item.b}</p>
                  </article>
                ))}
              </div>
            </div>
          </section>

          {/* ═══ PRODUTOS ═══ */}
          <section id="produtos" className="lpx-section lpx-section--tint lpx-anchor">
            <div className="lpx-wrap">
              <div className="text-center max-w-[660px] mx-auto" data-reveal>
                <p className="lpx-eyebrow lpx-eyebrow--accent">O que você vende</p>
                <h2 className="lpx-h2 mt-4">Nove produtos, uma licença</h2>
                <p className="lpx-lead mt-3">
                  A mesma conversa com o mesmo cliente pode virar mais de uma venda. Quem começa
                  pela conta de luz costuma vender telecom e clube depois.
                </p>
              </div>

              <div className="lpx-grid-3 mt-8 md:mt-12">
                {PRODUTOS_PARA_VENDER.map((p, i) => (
                  <article key={p.nome} className="lpx-card lpx-card--lift" data-reveal>
                    <span className="lpx-step__num lpx-step__num--accent" aria-hidden="true">
                      {String(i + 1).padStart(2, "0")}
                    </span>
                    <h3 className="lpx-h3 mt-3">{p.nome}</h3>
                    <p className="lpx-body mt-2">{p.resumo}</p>
                    <p className="lpx-step__meta lpx-accent-text">{p.comissao}</p>
                  </article>
                ))}
              </div>
            </div>
          </section>

          {/* ═══ CARREIRA ═══ */}
          <section id="carreira" className="lpx-section lpx-anchor">
            <div className="lpx-wrap">
              <div className="text-center max-w-[700px] mx-auto" data-reveal>
                <p className="lpx-eyebrow lpx-eyebrow--accent">Plano de carreira</p>
                <h2 className="lpx-h2 mt-4">
                  Cinco níveis, medidos em <span className="lpx-accent-text">kWh acumulado</span>
                </h2>
                <p className="lpx-lead mt-3">
                  O que destrava cada nível é o volume de energia contratada pelos seus clientes.
                  Subir de nível aumenta o seu percentual em todos os produtos, inclusive nas
                  vendas que você já fez.
                </p>
              </div>

              {/* Aviso antes dos números, não depois: quem lê o valor precisa
                  saber na hora que é meta, não salário. */}
              <div className="lpx-aviso mt-8 max-w-[760px] mx-auto" data-reveal>
                <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <circle cx="12" cy="12" r="9" />
                  <path d="M12 8v.01M12 11v5" />
                </svg>
                <p>
                  Os valores abaixo são <strong>bônus de qualificação do plano de carreira</strong>,
                  pagos ao atingir a meta de kWh do nível. Não são salário nem renda garantida — o
                  resultado depende do seu trabalho.
                </p>
              </div>

              <div className="lpx-niveis mt-8 max-w-[860px] mx-auto">
                {NIVEIS_CARREIRA.map((nivel) => (
                  <article key={nivel.nome} className="lpx-nivel" data-reveal>
                    <div className="lpx-nivel__topo">
                      <div className="lpx-nivel__id">
                        <span className="lpx-nivel__ordem" aria-hidden="true">
                          {nivel.ordem}
                        </span>
                        <div>
                          <h3 className="lpx-h3">{nivel.nome}</h3>
                          <p className="lpx-nivel__meta">Ao acumular {nivel.meta}</p>
                        </div>
                      </div>
                      <div className="lpx-nivel__bonus">
                        <span className="lpx-nivel__bonus-v">{nivel.bonus}</span>
                        <span className="lpx-nivel__bonus-r">bônus de qualificação</span>
                        {nivel.extra && (
                          <span className="lpx-nivel__extra">+ {nivel.extra}</span>
                        )}
                      </div>
                    </div>

                    <ul className="lpx-nivel__lista">
                      {nivel.acrescimos.map((a) => (
                        <li key={a}>{a}</li>
                      ))}
                    </ul>
                  </article>
                ))}
              </div>

              <figure className="lpx-media mt-10 max-w-[860px] mx-auto" data-reveal>
                <img
                  src={IMAGENS_EXPANSAO.qualificacoes}
                  alt="Tabela oficial de qualificações do plano de carreira iGreen Energy"
                  width={1200}
                  height={800}
                  loading="lazy"
                  decoding="async"
                  style={{ aspectRatio: "3 / 2" }}
                />
              </figure>
            </div>
          </section>

          {/* ═══ EQUIPE (EXPANSÃO) ═══ */}
          <section className="lpx-section lpx-section--tint">
            <div className="lpx-wrap">
              <div className="lpx-split">
                <div data-reveal>
                  <p className="lpx-eyebrow lpx-eyebrow--accent">Conexão Expansão</p>
                  <h2 className="lpx-h2 mt-4">Formar equipe é opcional — e acelera</h2>
                  <p className="lpx-lead mt-3">
                    Você pode operar só com venda direta. Se quiser, também pode cadastrar outros
                    licenciados e receber bônus e percentual sobre o trabalho deles.
                  </p>

                  <div className="grid grid-cols-1 gap-3 mt-7">
                    <div className="lpx-card !p-4" data-reveal>
                      <h3 className="lpx-h3 !text-base">Licenciado direto (1º nível)</h3>
                      <ul className="lpx-lista-check mt-2">
                        {MECANICA_EQUIPE.primeiroNivel.map((i) => (
                          <li key={i}>{i}</li>
                        ))}
                      </ul>
                    </div>
                    <div className="lpx-card !p-4" data-reveal>
                      <h3 className="lpx-h3 !text-base">Indireto (2º ao 5º nível)</h3>
                      <ul className="lpx-lista-check mt-2">
                        {MECANICA_EQUIPE.segundoNivel.map((i) => (
                          <li key={i}>{i}</li>
                        ))}
                      </ul>
                    </div>
                    <div className="lpx-card !p-4" data-reveal>
                      <h3 className="lpx-h3 !text-base">Qualificação por equipe</h3>
                      <ul className="lpx-lista-check mt-2">
                        {MECANICA_EQUIPE.qualificacao.map((i) => (
                          <li key={i}>{i}</li>
                        ))}
                      </ul>
                    </div>
                  </div>
                </div>

                <div className="lpx-split__media" data-reveal>
                  <figure className="lpx-media">
                    <img
                      src={IMAGENS_EXPANSAO.expansao}
                      alt="Estrutura de equipe da Conexão Expansão iGreen"
                      width={900}
                      height={900}
                      loading="lazy"
                      decoding="async"
                      style={{ aspectRatio: "1 / 1" }}
                    />
                  </figure>
                </div>
              </div>
            </div>
          </section>

          {/* ═══ COMO COMEÇAR ═══ */}
          <section id="passos" className="lpx-section lpx-anchor">
            <div className="lpx-wrap">
              <div className="text-center max-w-[640px] mx-auto" data-reveal>
                <p className="lpx-eyebrow lpx-eyebrow--accent">Como começar</p>
                <h2 className="lpx-h2 mt-4">Quatro passos, do zero à primeira venda</h2>
                <p className="lpx-lead mt-3">
                  Ninguém começa vendendo sistema fotovoltaico. Começa pela conta de luz, que é o
                  produto mais simples de explicar.
                </p>
              </div>

              <ol className="lpx-grid-2 mt-8 md:mt-12 list-none p-0">
                {PASSOS_EXPANSAO.map((passo) => (
                  <li key={passo.n} className="lpx-card lpx-card--lift lpx-card--edge" data-reveal>
                    <div className="flex items-center gap-3">
                      <span className="lpx-step__num lpx-step__num--accent" aria-hidden="true">
                        {passo.n}
                      </span>
                      <h3 className="lpx-h3">{passo.t}</h3>
                    </div>
                    <p className="lpx-body mt-3">{passo.b}</p>
                    <p className="lpx-step__meta lpx-accent-text">{passo.meta}</p>
                  </li>
                ))}
              </ol>
            </div>
          </section>

          {/* ═══ A LICENÇA ═══ */}
          <section id="licenca" className="lpx-section lpx-section--tint lpx-anchor">
            <div className="lpx-wrap">
              <div className="text-center max-w-[640px] mx-auto" data-reveal>
                <p className="lpx-eyebrow lpx-eyebrow--accent">A licença</p>
                <h2 className="lpx-h2 mt-4">O que você recebe para trabalhar</h2>
                <p className="lpx-lead mt-3">
                  Você não começa do zero: o material, o sistema e o treinamento vêm com a licença.
                </p>
              </div>

              <div className="lpx-grid-3 mt-8 md:mt-12">
                {LICENCA_INCLUI.map((item) => (
                  <article key={item.t} className="lpx-card lpx-card--lift" data-reveal>
                    <span className="lpx-icon lpx-icon--accent" aria-hidden="true">
                      <Icon name={item.icone} />
                    </span>
                    <h3 className="lpx-h3 mt-4">{item.t}</h3>
                    <p className="lpx-body mt-2">{item.b}</p>
                  </article>
                ))}
              </div>

              <figure className="lpx-media mt-10 max-w-[520px] mx-auto" data-reveal>
                <img
                  src={IMAGENS_EXPANSAO.kit}
                  alt="Kit do licenciado iGreen Energy: crachá, folders, adesivos e chips"
                  width={900}
                  height={900}
                  loading="lazy"
                  decoding="async"
                  style={{ aspectRatio: "1 / 1" }}
                />
              </figure>
            </div>
          </section>

          {/* ═══ OBJEÇÕES ═══ */}
          <section id="objecoes" className="lpx-section lpx-anchor">
            <div className="lpx-wrap">
              <div className="text-center max-w-[620px] mx-auto" data-reveal>
                <p className="lpx-eyebrow lpx-eyebrow--accent">Sem rodeio</p>
                <h2 className="lpx-h2 mt-4">As perguntas difíceis</h2>
                <p className="lpx-lead mt-3">
                  Inclusive as que a maioria das páginas de oportunidade evita responder.
                </p>
              </div>

              <div className="lpx-faq mt-8 md:mt-10 max-w-[760px] mx-auto" data-reveal>
                {OBJECOES_EXPANSAO.map((item) => (
                  <details key={item.q} className="lpx-faq__item">
                    <summary className="lpx-faq__q">
                      <span>{item.q}</span>
                      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" className="lpx-faq__chev lpx-accent-text" aria-hidden="true">
                        <path d="m6 9 6 6 6-6" />
                      </svg>
                    </summary>
                    <p className="lpx-faq__a">{item.a}</p>
                  </details>
                ))}
              </div>
            </div>
          </section>

          {/* ═══ CONSULTOR ═══ */}
          <PremiumConsultantCard
            nome={consultant.name}
            photoUrl={consultant.photo_url}
            igreenId={consultant.igreen_id}
            marca="iGreen Energy"
            whatsappUrl={whatsappUrl}
            cadastroUrl={cadastroUrl}
            onWhatsAppClick={trackWhatsApp}
            onCadastroClick={trackCadastro}
            intro="Eu já sou licenciado iGreen. Posso te contar como funciona na prática, o que deu certo e o que não deu — antes de você decidir qualquer coisa."
            promessas={[
              "Explico a remuneração de cada produto sem esconder número",
              "Falo dos valores e das condições atuais da licença",
              "Acompanho seus primeiros cadastros se você entrar",
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
                  Antes de decidir,{" "}
                  <span className="lpx-accent-text">tire as dúvidas com quem já faz.</span>
                </h2>
                <p className="lpx-lead mt-4">
                  Uma conversa resolve o que nenhuma página resolve: as condições atuais da
                  licença, o que dá para esperar no início e se isso encaixa na sua rotina.
                </p>

                <div className="lpx-actions mt-8 max-w-[440px] sm:max-w-none mx-auto">
                  <a
                    href={whatsappUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={trackWhatsApp}
                    className="lpx-btn lpx-btn--wa"
                  >
                    Falar com {firstName}
                  </a>
                  <a
                    href={cadastroUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={trackCadastro}
                    className="lpx-btn lpx-btn--ghost"
                  >
                    Ir para o cadastro
                  </a>
                </div>

                <p className="lpx-body !text-xs mt-5">
                  9 produtos · Comissão recorrente · Treinamento incluído ·{" "}
                  {PROVA_SOCIAL_TEXTO.clientes} na base
                </p>
              </div>
            </div>
          </section>

          <footer className="lpx-footer">
            <div className="lpx-wrap">
              <p className="lpx-body !text-xs uppercase tracking-[0.1em] break-words">
                {consultant.name.toUpperCase()} · CONSULTOR(A) IGREEN ENERGY
                {consultant.igreen_id ? ` · ID ${consultant.igreen_id}` : ""}
              </p>
              <p className="lpx-footer__legal lpx-measure mx-auto">{LEGAL_EXPANSAO}</p>
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
          rotuloSecundario="Carreira"
          hrefSecundario="#carreira"
        />
      </div>

      <WhatsAppFloat url={whatsappUrl} onClickTrack={trackWhatsApp} />
    </>
  );
};

export default ExpansaoPremiumPage;
