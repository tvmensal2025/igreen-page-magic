import { useRef, useState } from "react";

interface PosterVideoProps {
  src: string;
  poster: string;
  /** Texto do botão de play, lido por leitor de tela. */
  label: string;
  /** `frame` = 16:9 com moldura; `tile` = 9:16 dos depoimentos. */
  variant?: "frame" | "tile";
  className?: string;
}

/**
 * Vídeo que começa como imagem.
 *
 * Enquanto ninguém clica, o navegador baixa só o poster `.webp` (poucos KB) —
 * a tag <video> nem existe no DOM. No clique, montamos o vídeo e damos play.
 *
 * Isso resolve dois problemas de uma vez:
 * - LCP: a primeira dobra carrega uma imagem leve, não um MP4 de vários MB.
 * - CLS: o container tem `aspect-ratio` fixo no CSS, então o espaço já está
 *   reservado e nada empurra o layout quando a mídia troca.
 */
export function PosterVideo({
  src,
  poster,
  label,
  variant = "frame",
  className,
}: PosterVideoProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [started, setStarted] = useState(false);

  const start = () => {
    setStarted(true);
    // Espera o React montar o <video> antes de pedir play.
    requestAnimationFrame(() => {
      videoRef.current?.play().catch(() => {
        /* Autoplay bloqueado: os controles nativos ficam visíveis. */
      });
    });
  };

  const media = (
    <>
      {started ? (
        <video
          ref={videoRef}
          controls
          playsInline
          preload="metadata"
          poster={poster}
        >
          <source src={src} type="video/mp4" />
          Seu navegador não suporta vídeos.
        </video>
      ) : (
        <>
          <img src={poster} alt="" loading="lazy" decoding="async" aria-hidden="true" />
          <button type="button" className="lpx-play" onClick={start} aria-label={label}>
            <span className="lpx-play__ring" aria-hidden="true">
              <svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor">
                <path d="M8 5v14l11-7z" />
              </svg>
            </span>
          </button>
        </>
      )}
    </>
  );

  if (variant === "tile") {
    return <div className={`lpx-vid ${className ?? ""}`}>{media}</div>;
  }

  return (
    <div className={`lpx-frame ${className ?? ""}`}>
      <div className="lpx-frame__media">{media}</div>
    </div>
  );
}

interface StaticImageProps {
  src: string;
  alt: string;
  width: number;
  height: number;
  className?: string;
  /** `true` só na imagem da primeira dobra (evita lazy no LCP). */
  priority?: boolean;
}

/**
 * Imagem com `width`/`height` explícitos.
 *
 * Os atributos numéricos deixam o navegador calcular a proporção antes do
 * download e reservar o espaço — é o que impede o salto de layout (CLS).
 */
export function StaticImage({
  src,
  alt,
  width,
  height,
  className,
  priority = false,
}: StaticImageProps) {
  return (
    <div className={`lpx-media ${className ?? ""}`}>
      <img
        src={src}
        alt={alt}
        width={width}
        height={height}
        loading={priority ? "eager" : "lazy"}
        // Atributo em minúsculas: o React 18 não reconhece `fetchPriority` em
        // camelCase e emitiria aviso no console. Em minúsculas ele passa direto
        // para o DOM, que é o que o Chrome lê para priorizar o LCP.
        {...{ fetchpriority: priority ? "high" : "auto" }}
        decoding={priority ? "sync" : "async"}
        style={{ aspectRatio: `${width} / ${height}` }}
      />
    </div>
  );
}
