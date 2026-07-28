import { useCallback, useEffect, useId, useRef, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import BrandLogo from "@/components/common/BrandLogo";
import { GRUPO_LABEL, PREMIUM_ROUTES, type PremiumRoute } from "./premiumRoutes";
import { useScrolledPast } from "../useReveal";

interface PremiumSiteNavProps {
  /** Licença do consultor, para montar os links entre as páginas. */
  licenca: string;
  /** `id` da rota premium atual (marca o item ativo). */
  atual: string;
  /** Âncoras da própria página (aparecem antes do menu de soluções). */
  ancoras?: { label: string; href: string }[];
  whatsappUrl: string;
  ctaLabel?: string;
  onWhatsAppClick: () => void;
}

/**
 * Navegação compartilhada por todas as páginas premium.
 *
 * Duas responsabilidades que a LP original não cobria:
 *
 * 1. **Navegar entre soluções.** Hoje cada `/conexao-*` é uma ilha: quem entra
 *    na de telecom não tem como chegar na de seguros. Aqui existe um menu único
 *    com as 9 páginas, agrupadas, preservando a licença do consultor na URL.
 * 2. **Menu mobile de verdade.** Painel em tela cheia com foco preso dentro
 *    dele, `Esc` para fechar, rolagem do fundo travada e fechamento automático
 *    ao escolher um item. O botão voltar do navegador continua funcionando
 *    porque a navegação é feita por `<Link>` do React Router.
 */
const PremiumSiteNav = ({
  licenca,
  atual,
  ancoras = [],
  whatsappUrl,
  ctaLabel = "Falar no WhatsApp",
  onWhatsAppClick,
}: PremiumSiteNavProps) => {
  const [scrolled, setScrolled] = useState(false);
  const [aberto, setAberto] = useState(false);
  const [solucoesAbertas, setSolucoesAbertas] = useState(false);

  const painelRef = useRef<HTMLDivElement>(null);
  const botaoRef = useRef<HTMLButtonElement>(null);
  const solucoesRef = useRef<HTMLDivElement>(null);
  const painelId = useId();
  const solucoesId = useId();
  const location = useLocation();

  useScrolledPast(20, useCallback((past: boolean) => setScrolled(past), []));

  const fechar = useCallback(() => {
    setAberto(false);
    // Devolve o foco para o botão que abriu — sem isso quem usa teclado
    // "perde o lugar" e volta para o começo da página.
    botaoRef.current?.focus();
  }, []);

  // Fecha o menu ao trocar de rota (clique num item leva a outra página).
  useEffect(() => {
    setAberto(false);
    setSolucoesAbertas(false);
  }, [location.pathname]);

  // Trava a rolagem do fundo enquanto o painel está aberto.
  useEffect(() => {
    if (!aberto) return;
    const anterior = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = anterior;
    };
  }, [aberto]);

  // Esc fecha, Tab circula dentro do painel (foco preso).
  useEffect(() => {
    if (!aberto) return;

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        fechar();
        return;
      }
      if (e.key !== "Tab") return;

      const foco = painelRef.current?.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled])',
      );
      if (!foco || foco.length === 0) return;

      const primeiro = foco[0];
      const ultimo = foco[foco.length - 1];

      if (e.shiftKey && document.activeElement === primeiro) {
        e.preventDefault();
        ultimo.focus();
      } else if (!e.shiftKey && document.activeElement === ultimo) {
        e.preventDefault();
        primeiro.focus();
      }
    };

    document.addEventListener("keydown", onKeyDown);
    // Move o foco para dentro do painel ao abrir.
    painelRef.current?.querySelector<HTMLElement>("a[href], button")?.focus();

    return () => document.removeEventListener("keydown", onKeyDown);
  }, [aberto, fechar]);

  // Fecha o dropdown de soluções (desktop) ao clicar fora ou apertar Esc.
  useEffect(() => {
    if (!solucoesAbertas) return;

    const onClickFora = (e: MouseEvent) => {
      if (!solucoesRef.current?.contains(e.target as Node)) setSolucoesAbertas(false);
    };
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") setSolucoesAbertas(false);
    };

    document.addEventListener("mousedown", onClickFora);
    document.addEventListener("keydown", onEsc);
    return () => {
      document.removeEventListener("mousedown", onClickFora);
      document.removeEventListener("keydown", onEsc);
    };
  }, [solucoesAbertas]);

  const grupos = PREMIUM_ROUTES.reduce<Record<string, PremiumRoute[]>>((acc, rota) => {
    (acc[rota.grupo] ||= []).push(rota);
    return acc;
  }, {});

  const rotaAtual = PREMIUM_ROUTES.find((r) => r.id === atual);

  return (
    <>
      <header className="lpx-nav" data-scrolled={scrolled}>
        <div className="lpx-wrap lpx-nav__inner">
          <Link
            to={`/premium/${licenca}`}
            aria-label="Início — iGreen Energy"
            className="lpx-nav__brand"
          >
            <BrandLogo className="w-[88px] md:w-[106px]" />
          </Link>

          {/* ── Desktop ── */}
          <nav className="lpx-nav__links" aria-label="Navegação principal">
            {ancoras.map((a) => (
              <a key={a.href} href={a.href} className="lpx-nav__link">
                {a.label}
              </a>
            ))}

            <div className="lpx-nav__drop" ref={solucoesRef}>
              <button
                type="button"
                className="lpx-nav__link lpx-nav__link--btn"
                aria-expanded={solucoesAbertas}
                aria-controls={solucoesId}
                onClick={() => setSolucoesAbertas((v) => !v)}
              >
                Soluções
                <svg
                  viewBox="0 0 24 24"
                  width="15"
                  height="15"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.4"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                  data-open={solucoesAbertas}
                  className="lpx-nav__chev"
                >
                  <path d="m6 9 6 6 6-6" />
                </svg>
              </button>

              {solucoesAbertas && (
                <div className="lpx-nav__panel" id={solucoesId} role="group" aria-label="Soluções iGreen">
                  {Object.entries(grupos).map(([grupo, rotas]) => (
                    <div key={grupo} className="lpx-nav__panel-grupo">
                      <p className="lpx-nav__panel-titulo">
                        {GRUPO_LABEL[grupo as PremiumRoute["grupo"]]}
                      </p>
                      {rotas.map((rota) => (
                        <Link
                          key={rota.id}
                          to={rota.path(licenca)}
                          className="lpx-nav__item"
                          aria-current={rota.id === atual ? "page" : undefined}
                          onClick={() => setSolucoesAbertas(false)}
                        >
                          <span className="lpx-nav__item-label">{rota.label}</span>
                          <span className="lpx-nav__item-resumo">{rota.resumo}</span>
                        </Link>
                      ))}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </nav>

          <div className="lpx-nav__acoes">
            <a
              href={whatsappUrl}
              target="_blank"
              rel="noopener noreferrer"
              onClick={onWhatsAppClick}
              className="lpx-btn lpx-btn--accent lpx-nav__cta"
            >
              <span className="hidden sm:inline">{ctaLabel}</span>
              <span className="sm:hidden">WhatsApp</span>
            </a>

            {/* ── Botão do menu (só mobile/tablet) ── */}
            <button
              type="button"
              ref={botaoRef}
              className="lpx-nav__burger"
              aria-expanded={aberto}
              aria-controls={painelId}
              aria-label={aberto ? "Fechar menu" : "Abrir menu de soluções"}
              onClick={() => setAberto((v) => !v)}
            >
              <span className="lpx-nav__burger-bar" data-open={aberto} />
              <span className="lpx-nav__burger-bar" data-open={aberto} />
            </button>
          </div>
        </div>
      </header>

      {/* ── Painel mobile ── */}
      <div
        className="lpx-sheet"
        data-open={aberto}
        // Enquanto fechado sai do leitor de tela e do Tab.
        aria-hidden={!aberto}
      >
        {/* Fundo clicável para fechar. Não é o único caminho: há botão e Esc. */}
        <button
          type="button"
          className="lpx-sheet__fundo"
          tabIndex={-1}
          aria-hidden="true"
          onClick={fechar}
        />

        <div
          className="lpx-sheet__painel"
          id={painelId}
          ref={painelRef}
          role="dialog"
          aria-modal={aberto}
          aria-label="Soluções iGreen"
        >
          <div className="lpx-sheet__topo">
            <p className="lpx-sheet__titulo">Soluções iGreen</p>
            <button type="button" className="lpx-sheet__fechar" onClick={fechar} aria-label="Fechar menu">
              <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true">
                <path d="M18 6 6 18M6 6l12 12" />
              </svg>
            </button>
          </div>

          <div className="lpx-sheet__corpo">
            {ancoras.length > 0 && (
              <div className="lpx-sheet__grupo">
                <p className="lpx-sheet__grupo-titulo">
                  Nesta página{rotaAtual ? ` · ${rotaAtual.label}` : ""}
                </p>
                <div className="lpx-sheet__ancoras">
                  {ancoras.map((a) => (
                    <a key={a.href} href={a.href} className="lpx-sheet__ancora" onClick={fechar}>
                      {a.label}
                    </a>
                  ))}
                </div>
              </div>
            )}

            {Object.entries(grupos).map(([grupo, rotas]) => (
              <div key={grupo} className="lpx-sheet__grupo">
                <p className="lpx-sheet__grupo-titulo">
                  {GRUPO_LABEL[grupo as PremiumRoute["grupo"]]}
                </p>
                {rotas.map((rota) => (
                  <Link
                    key={rota.id}
                    to={rota.path(licenca)}
                    className="lpx-sheet__item"
                    aria-current={rota.id === atual ? "page" : undefined}
                    onClick={fechar}
                  >
                    <span className="lpx-sheet__item-label">
                      {rota.label}
                      {rota.id === atual && <span className="lpx-sheet__aqui">você está aqui</span>}
                    </span>
                    <span className="lpx-sheet__item-resumo">{rota.resumo}</span>
                  </Link>
                ))}
              </div>
            ))}
          </div>

          <div className="lpx-sheet__pe">
            <a
              href={whatsappUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="lpx-btn lpx-btn--wa lpx-btn--block"
              onClick={() => {
                onWhatsAppClick();
                fechar();
              }}
            >
              {ctaLabel}
            </a>
          </div>
        </div>
      </div>
    </>
  );
};

export default PremiumSiteNav;
