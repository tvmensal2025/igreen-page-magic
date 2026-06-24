import { SOLAR_DISCLAIMER } from "../lib/types";

export function SolarDisclaimer({ className = "" }: { className?: string }) {
  return (
    <p className={`text-xs text-muted-foreground leading-relaxed ${className}`}>
      {SOLAR_DISCLAIMER}
    </p>
  );
}
