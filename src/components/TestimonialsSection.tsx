import { useRef, useState } from "react";
import { Play } from "lucide-react";

const videos = [
  "/videos/depoimento-1.mp4",
  "/videos/depoimento-2.mp4",
  "/videos/depoimento-3.mp4",
  "/videos/depoimento-4.mp4",
  "/videos/depoimento-5.mp4",
];

function posterFor(src: string) {
  return src.replace("/videos/", "/videos/posters/").replace(/\.mp4$/, ".webp");
}

function VideoCard({ src, index }: { src: string; index: number }) {
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
          className="w-full aspect-[9/16] object-cover"
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
            <div className="w-14 h-14 rounded-full bg-primary/90 flex items-center justify-center shadow-lg transition-transform duration-300 group-hover:scale-110">
              <Play className="w-6 h-6 text-primary-foreground ml-1" fill="currentColor" />
            </div>
          </button>
        )}
      </div>
      <div className="px-3 py-2 text-center">
        <span className="text-xs text-muted-foreground">Depoimento {index + 1}</span>
      </div>
    </div>
  );
}

const TestimonialsSection = () => (
  <section className="section-gradient relative overflow-hidden">
    <div className="absolute inset-0 pointer-events-none opacity-[0.03]" style={{ background: 'radial-gradient(circle at 50% 80%, hsl(130, 100%, 36%), transparent 50%)' }} />
    <div className="section-container relative z-10">
      <div className="badge-green mx-auto mb-6">Depoimentos</div>
      <h2 className="section-heading mb-4">Clientes satisfeitos iGreen Energy</h2>
      <p className="text-center text-muted-foreground text-lg mb-14">
        Mais de 170 mil clientes já estão economizando na conta de luz
      </p>

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4 max-w-6xl mx-auto">
        {videos.map((src, i) => (
          <VideoCard key={i} src={src} index={i} />
        ))}
      </div>
    </div>
  </section>
);

export default TestimonialsSection;
