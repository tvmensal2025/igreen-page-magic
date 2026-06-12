import { useRef, useState } from "react";
import { Play } from "lucide-react";

const SUPABASE_BASE = "https://zlzasfhcxcznaprrragl.supabase.co/storage/v1/object/public/video%20igreen";

const videos = [
  `${SUPABASE_BASE}/noticia1.mp4`,
  `${SUPABASE_BASE}/noticia2.mp4`,
  `${SUPABASE_BASE}/noticia3.mp4`,
  `${SUPABASE_BASE}/noticia4.mp4`,
  `${SUPABASE_BASE}/noticia5.mp4`,
  `${SUPABASE_BASE}/noticia6.mp4`,
  `${SUPABASE_BASE}/noticaia9.mp4`,
];

function posterFor(src: string) {
  const file = src.split("/").pop()?.replace(/\.mp4$/, "") || "";
  return `/videos/posters/${file}.webp`;
}

function NewsVideoCard({ src }: { src: string }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false);

  const handlePlay = () => {
    if (videoRef.current) {
      videoRef.current.play();
      setPlaying(true);
    }
  };

  return (
    <div className="group relative rounded-2xl overflow-hidden border border-primary/10 bg-card/50 backdrop-blur-sm transition-all duration-300 hover:border-primary/30 hover:scale-[1.02]" style={{ boxShadow: 'var(--shadow-card)' }}>
      <div className="relative">
        <video
          ref={videoRef}
          controls={playing}
          preload="none"
          poster={posterFor(src)}
          className="w-full aspect-[4/3] object-cover"
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
        >
          <source src={src} type="video/mp4" />
        </video>
        {!playing && (
          <button
            onClick={handlePlay}
            className="absolute inset-0 flex items-center justify-center bg-black/30 transition-all duration-300 group-hover:bg-black/20"
          >
            <div className="w-16 h-16 rounded-full bg-primary/90 flex items-center justify-center shadow-lg transition-transform duration-300 group-hover:scale-110">
              <Play className="w-7 h-7 text-primary-foreground ml-1" fill="currentColor" />
            </div>
          </button>
        )}
      </div>
    </div>
  );
}

const NewsSection = () => (
  <section className="section-gradient relative overflow-hidden">
    <div className="absolute inset-0 pointer-events-none opacity-[0.03]" style={{ background: 'radial-gradient(circle at 50% 80%, hsl(130, 100%, 36%), transparent 50%)' }} />
    <div className="section-container relative z-10">
      <div className="badge-green mx-auto mb-6">Reportagens</div>
      <h2 className="section-heading mb-4">
        Reportagens sobre os descontos na conta de luz dos nossos clientes
      </h2>
      <p className="text-center text-muted-foreground text-lg mb-14">
        Veja como a mídia tem falado sobre a economia na conta de luz proporcionada pela iGreen Energy
      </p>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6 max-w-6xl mx-auto">
        {videos.map((src, i) => (
          <NewsVideoCard key={i} src={src} />
        ))}
      </div>
    </div>
  </section>
);

export default NewsSection;
