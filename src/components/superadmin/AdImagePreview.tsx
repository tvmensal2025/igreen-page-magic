import { AdPhotoFormat } from "@/services/adTemplates";

const RATIOS: Record<AdPhotoFormat, { aspect: string; label: string; safe: { top: string; bottom: string } }> = {
  square:   { aspect: "1 / 1",  label: "1:1 Feed",  safe: { top: "7%",  bottom: "7%"  } },
  vertical: { aspect: "4 / 5",  label: "4:5 Feed",  safe: { top: "5%",  bottom: "5%"  } },
  story:    { aspect: "9 / 16", label: "9:16 Reels", safe: { top: "14%", bottom: "20%" } },
};

export function AdImagePreview({ url, format, size = 90 }: { url: string; format: AdPhotoFormat; size?: number }) {
  const r = RATIOS[format];
  return (
    <div className="relative rounded overflow-hidden border bg-black/40" style={{ aspectRatio: r.aspect, width: size }}>
      <img src={url} alt="" className="w-full h-full object-cover" />
      {/* safe-area overlay */}
      <div
        className="absolute inset-x-0 border-y border-dashed border-primary/70 pointer-events-none"
        style={{ top: r.safe.top, bottom: r.safe.bottom }}
      />
      <span className="absolute bottom-0.5 left-0.5 bg-background/90 text-[8px] px-1 rounded">{r.label}</span>
    </div>
  );
}