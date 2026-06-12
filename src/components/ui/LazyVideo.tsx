import { useEffect, useRef, useState } from "react";

interface LazyVideoProps {
  src: string;
  type?: string;
  className?: string;
  poster?: string;
  playsInline?: boolean;
  rootMargin?: string;
  /** Texto de acessibilidade para o botão de play. */
  label?: string;
}

/**
 * Vídeo "preguiçoso" e profissional:
 *
 * 1. Só monta a tag <video> quando o elemento chega perto da tela
 *    (IntersectionObserver). Isso evita abrir conexão / handshake com o
 *    servidor de mídia antes da hora.
 * 2. Mesmo depois de montado, usa `preload="none"`: o navegador NÃO baixa
 *    o vídeo até o usuário clicar no play.
 * 3. Mostra uma capa com botão de play. O download (que pode ser de vários
 *    MB) só começa quando a pessoa decide assistir.
 *
 * Resultado: a página abre rápido e nenhum vídeo é removido — todos
 * continuam disponíveis, só carregam sob demanda.
 */
export function LazyVideo({
  src,
  type = "video/mp4",
  className = "w-full aspect-video relative z-0",
  poster,
  playsInline = true,
  rootMargin = "300px",
  label = "Reproduzir vídeo",
}: LazyVideoProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [visible, setVisible] = useState(false);
  const [started, setStarted] = useState(false);

  useEffect(() => {
    if (visible) return;
    const el = containerRef.current;
    if (!el || typeof IntersectionObserver === "undefined") {
      setVisible(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            setVisible(true);
            observer.disconnect();
            break;
          }
        }
      },
      { rootMargin },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [visible, rootMargin]);

  const handlePlay = () => {
    setStarted(true);
    // Espera o vídeo montar/atualizar antes de chamar play().
    requestAnimationFrame(() => {
      videoRef.current?.play().catch(() => {/* ignorado: usuário pode dar play manualmente */});
    });
  };

  return (
    <div ref={containerRef} className="relative w-full h-full">
      {visible && (
        <video
          ref={videoRef}
          controls={started}
          playsInline={playsInline}
          preload="none"
          poster={poster}
          className={className}
          onPlay={() => setStarted(true)}
        >
          <source src={src} type={type} />
          Seu navegador não suporta vídeos.
        </video>
      )}

      {!started && (
        <button
          type="button"
          onClick={handlePlay}
          aria-label={label}
          className="absolute inset-0 z-20 flex items-center justify-center bg-black/30 transition-colors duration-300 hover:bg-black/20"
        >
          <span className="w-16 h-16 rounded-full bg-primary/90 flex items-center justify-center shadow-lg transition-transform duration-300 hover:scale-110">
            <svg viewBox="0 0 24 24" className="w-7 h-7 text-primary-foreground ml-1" fill="currentColor" aria-hidden="true">
              <path d="M8 5v14l11-7z" />
            </svg>
          </span>
        </button>
      )}
    </div>
  );
}

export default LazyVideo;
