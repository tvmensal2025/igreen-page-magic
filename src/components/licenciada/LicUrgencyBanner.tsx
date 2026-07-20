import { useEffect, useState } from "react";

const LicUrgencyBanner = () => {
  const DURATION = 24 * 60 * 60 * 1000; // 24h in ms
  const STORAGE_KEY = "urgency_timer_start";

  const getStartTime = () => {
    const saved = localStorage.getItem(STORAGE_KEY);
    const now = Date.now();
    if (saved) {
      const start = Number(saved);
      if (now - start < DURATION) return start;
    }
    localStorage.setItem(STORAGE_KEY, String(now));
    return now;
  };

  const calcTimeLeft = (start: number) => {
    const diff = Math.max(0, start + DURATION - Date.now());
    return {
      hours: Math.floor(diff / (1000 * 60 * 60)),
      minutes: Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60)),
      seconds: Math.floor((diff % (1000 * 60)) / 1000),
    };
  };

  const [timeLeft, setTimeLeft] = useState({ hours: 23, minutes: 59, seconds: 59 });

  useEffect(() => {
    let start = getStartTime();
    setTimeLeft(calcTimeLeft(start));
    const interval = setInterval(() => {
      const tl = calcTimeLeft(start);
      if (tl.hours === 0 && tl.minutes === 0 && tl.seconds === 0) {
        start = Date.now();
        localStorage.setItem(STORAGE_KEY, String(start));
      }
      setTimeLeft(calcTimeLeft(start));
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  const pad = (n: number) => n.toString().padStart(2, "0");

  return (
    <section className="relative overflow-hidden py-6" style={{ background: 'linear-gradient(135deg, hsl(0 85% 40%), hsl(30 100% 45%), hsl(0 85% 40%))' }}>
      <div className="absolute inset-0 opacity-20" style={{ background: 'repeating-linear-gradient(45deg, transparent, transparent 10px, rgba(0,0,0,0.1) 10px, rgba(0,0,0,0.1) 20px)' }} />
      
      <div className="section-container !py-0 relative z-10 text-center">
        <div className="flex flex-col md:flex-row items-center justify-center gap-4 md:gap-8 min-w-0">
          <div className="flex items-center gap-2 min-w-0 px-1">
            <span className="text-2xl md:text-3xl animate-pulse shrink-0">🔥</span>
            <div className="text-left min-w-0">
              <p className="text-white/90 text-xs md:text-sm font-heading uppercase tracking-widest font-bold">Vagas limitadas</p>
              <p className="text-white font-heading font-black text-base sm:text-lg md:text-2xl leading-tight">
                Essa oportunidade não vai esperar por você
              </p>
            </div>
          </div>
          
          <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
            {[
              { value: pad(timeLeft.hours), label: "horas" },
              { value: pad(timeLeft.minutes), label: "min" },
              { value: pad(timeLeft.seconds), label: "seg" },
            ].map((t, i) => (
              <div key={i} className="flex items-center gap-2">
                <div className="bg-black/40 backdrop-blur-sm rounded-lg px-3 py-2 min-w-[56px] text-center border border-white/20">
                  <span className="text-white font-heading font-black text-2xl md:text-3xl tabular-nums">{t.value}</span>
                  <p className="text-white/70 text-[10px] uppercase tracking-wider font-heading">{t.label}</p>
                </div>
                {i < 2 && <span className="text-white font-bold text-2xl animate-pulse">:</span>}
              </div>
            ))}
          </div>
        </div>
        
        <p className="text-white/80 text-sm mt-3 font-heading px-2 leading-relaxed">
          ⚠️ As condições exclusivas de hoje podem mudar a qualquer momento. <strong className="text-white">Não perca essa chance!</strong>
        </p>
      </div>
    </section>
  );
};

export default LicUrgencyBanner;
