import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Vídeo com reprodução automática de verdade — e degradação honesta.
 *
 * ── Por que este componente existe ──────────────────────────────────────────
 * O `LazyVideo` do projeto (e a primeira versão da LP premium) só montava a tag
 * `<video>` depois de um clique. Não havia caminho nenhum de autoplay: o hero
 * ficava parado numa imagem com botão de play. É essa a causa do vídeo "não
 * aparecer" tocando.
 *
 * O padrão de autoplay já existia no repo (`LicHeroSection` usa
 * `autoPlay muted loop playsInline`), então aqui ele é seguido — só com o
 * cuidado extra de não torrar o pacote de dados de quem está no celular.
 *
 * ── Como funciona ──────────────────────────────────────────────────────────
 * 1. O poster (`.webp`, ~12 KB) é pintado imediatamente. O `<video>` existe no
 *    DOM desde o início, mas SEM `<source>` — então nada é baixado ainda.
 * 2. Quando o elemento entra na tela (IntersectionObserver) e o navegador está
 *    ocioso (requestIdleCallback), o `<source>` é injetado e o autoplay começa.
 *    Assim o MP4 nunca compete com o primeiro carregamento da página.
 * 3. Se a conexão for econômica/lenta, ou a pessoa pedir menos movimento, o
 *    autoplay é abandonado e o vídeo vira clique-para-tocar. Ninguém recebe
 *    10 MB sem querer.
 * 4. Qualquer falha (rede, host de mídia fora, codec) cai no poster com botão
 *    de repetir. Nunca sobra retângulo preto.
 *
 * ── Anti-CLS ───────────────────────────────────────────────────────────────
 * O container tem `aspect-ratio` fixo, então o espaço está reservado antes de
 * qualquer byte de mídia chegar.
 */

type Estado = "poster" | "carregando" | "tocando" | "erro";

interface AutoplayVideoProps {
  src: string;
  poster: string;
  /** Descrição do conteúdo, para leitor de tela e para o botão de play. */
  label: string;
  /** `16/9` (padrão) ou `9/16` para vertical. */
  aspect?: "16/9" | "9/16";
  /**
   * `false` desliga o autoplay e entrega clique-para-tocar.
   * Use em vídeos longos ou fora da primeira dobra.
   */
  autoplay?: boolean;
  /** Mostra os controles nativos assim que começar a tocar. */
  controls?: boolean;
  className?: string;
}

/**
 * Decide se vale gastar dados com autoplay.
 *
 * Leva em conta o modo de economia de dados e o tipo de conexão informados
 * pelo navegador (Network Information API, disponível no Chrome/Android — onde
 * está a maior parte do tráfego mobile) e a preferência de menos movimento.
 */
function autoplayEhApropriado(): boolean {
  if (typeof window === "undefined") return false;

  if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return false;

  const conexao = (
    navigator as Navigator & {
      connection?: { saveData?: boolean; effectiveType?: string };
    }
  ).connection;

  if (conexao?.saveData) return false;
  if (conexao?.effectiveType && /(^|-)(slow-)?2g$/.test(conexao.effectiveType)) return false;

  return true;
}

/** Executa quando o navegador estiver ocioso (com teto de tempo). */
function noOcioso(cb: () => void, teto = 900): () => void {
  const w = window as unknown as {
    requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
    cancelIdleCallback?: (id: number) => void;
  };

  if (typeof w.requestIdleCallback === "function") {
    const id = w.requestIdleCallback(cb, { timeout: teto });
    return () => w.cancelIdleCallback?.(id);
  }

  const id = window.setTimeout(cb, teto);
  return () => window.clearTimeout(id);
}

export function AutoplayVideo({
  src,
  poster,
  label,
  aspect = "16/9",
  autoplay = true,
  controls = true,
  className,
}: AutoplayVideoProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);

  // `armado` = o <source> já pode entrar no DOM (elemento visível + ocioso).
  const [armado, setArmado] = useState(false);
  const [estado, setEstado] = useState<Estado>("poster");
  // Guarda se o autoplay foi liberado nesta sessão de render.
  const autoplayLiberado = useRef(false);

  // ── Passo 1: só arma o download quando o vídeo chega perto da tela ────────
  useEffect(() => {
    if (armado) return;
    const el = wrapRef.current;
    if (!el) return;

    // Sem IntersectionObserver: arma direto (navegador antigo, raro).
    if (typeof IntersectionObserver === "undefined") {
      setArmado(true);
      return;
    }

    let cancelarOcioso: (() => void) | undefined;

    const observer = new IntersectionObserver(
      (entradas) => {
        if (!entradas.some((e) => e.isIntersecting)) return;
        observer.disconnect();
        // Espera o navegador respirar antes de puxar o MP4.
        cancelarOcioso = noOcioso(() => setArmado(true));
      },
      // 200px de antecedência: o vídeo já está pronto quando a pessoa chega.
      { rootMargin: "200px" },
    );

    observer.observe(el);
    return () => {
      observer.disconnect();
      cancelarOcioso?.();
    };
  }, [armado]);

  // ── Passo 2: com o <source> montado, tenta tocar ──────────────────────────
  useEffect(() => {
    if (!armado) return;
    const video = videoRef.current;
    if (!video) return;

    if (!autoplay || !autoplayEhApropriado()) {
      // Fica no poster aguardando o toque. Importante: NÃO chamar load() aqui.
      // Com preload="none" e sem load(), o navegador não busca nem os metadados
      // — quem está em economia de dados não paga nada pelo vídeo.
      setEstado("poster");
      return;
    }

    // `load()` só neste caminho: o <source> entrou depois da montagem, então o
    // elemento precisa ser avisado para reavaliar as fontes.
    video.load();
    autoplayLiberado.current = true;
    setEstado("carregando");

    video.play().catch(() => {
      // Autoplay negado pela política do navegador (acontece no iOS quando o
      // vídeo não está de fato mudo, ou em abas em segundo plano).
      // Não é erro: volta para clique-para-tocar.
      autoplayLiberado.current = false;
      setEstado("poster");
    });
  }, [armado, autoplay]);

  /** Play manual: também serve de "tentar de novo" depois de um erro. */
  const tocarManual = useCallback(() => {
    const video = videoRef.current;
    if (!armado) setArmado(true);
    setEstado("carregando");

    requestAnimationFrame(() => {
      if (!video) return;
      if (estado === "erro") video.load();
      video.muted = false;
      video.play().catch(() => {
        // Se falhar com som, tenta mudo — melhor tocar mudo do que não tocar.
        video.muted = true;
        video.play().catch(() => setEstado("erro"));
      });
    });
  }, [armado, estado]);

  const mostrarPoster = estado === "poster" || estado === "erro";

  return (
    <div
      ref={wrapRef}
      className={`lpx-video ${className ?? ""}`}
      data-aspect={aspect === "9/16" ? "vertical" : "wide"}
      data-estado={estado}
    >
      <video
        ref={videoRef}
        poster={poster}
        // muted + playsInline são obrigatórios para autoplay em iOS e Chrome.
        muted
        loop
        playsInline
        // `none`: nem os metadados são buscados antes de armar.
        preload="none"
        controls={controls && estado === "tocando"}
        aria-label={label}
        onPlaying={() => setEstado("tocando")}
        onError={() => setEstado("erro")}
        onStalled={() => {
          // Travou sem nunca começar: cai para o poster em vez de ficar preto.
          if (estado === "carregando") setEstado("poster");
        }}
      >
        {armado && <source src={src} type="video/mp4" />}
      </video>

      {/* Camada de poster + ação. Sai de cena quando o vídeo começa. */}
      {mostrarPoster && (
        <button
          type="button"
          className="lpx-video__cover"
          onClick={tocarManual}
          aria-label={estado === "erro" ? `Tentar carregar novamente: ${label}` : `Assistir: ${label}`}
        >
          <img src={poster} alt="" aria-hidden="true" loading="lazy" decoding="async" />
          <span className="lpx-video__btn" aria-hidden="true">
            {estado === "erro" ? (
              <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
                <path d="M21 12a9 9 0 1 1-3.4-7.05" />
                <path d="M21 4v5h-5" />
              </svg>
            ) : (
              <svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor">
                <path d="M8 5v14l11-7z" />
              </svg>
            )}
          </span>
          {estado === "erro" && (
            <span className="lpx-video__aviso">Não foi possível carregar o vídeo. Toque para tentar de novo.</span>
          )}
        </button>
      )}

      {/* Indicador discreto enquanto o vídeo abre. */}
      {estado === "carregando" && autoplayLiberado.current && (
        <span className="lpx-video__spin" aria-hidden="true" />
      )}

      {/* Botão de som: o autoplay é sempre mudo, então a pessoa precisa de um
          jeito óbvio de ouvir. */}
      {estado === "tocando" && <SomToggle videoRef={videoRef} />}
    </div>
  );
}

/** Alterna o som do vídeo que está tocando. */
function SomToggle({ videoRef }: { videoRef: React.RefObject<HTMLVideoElement> }) {
  const [mudo, setMudo] = useState(true);

  const alternar = () => {
    const video = videoRef.current;
    if (!video) return;
    video.muted = !video.muted;
    setMudo(video.muted);
  };

  return (
    <button
      type="button"
      className="lpx-video__som"
      onClick={alternar}
      aria-label={mudo ? "Ativar som do vídeo" : "Desativar som do vídeo"}
    >
      {mudo ? (
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
          <path d="M11 5 6 9H3v6h3l5 4z" />
          <path d="m17 9 4 6M21 9l-4 6" />
        </svg>
      ) : (
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
          <path d="M11 5 6 9H3v6h3l5 4z" />
          <path d="M16 8.5a5 5 0 0 1 0 7M19 6a9 9 0 0 1 0 12" />
        </svg>
      )}
    </button>
  );
}

export default AutoplayVideo;
