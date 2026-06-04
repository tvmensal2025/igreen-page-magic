// LGPD cookie banner — Fase 3 auditoria. Visual alinhado ao glassmorphism verde da LP.
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Link } from "react-router-dom";
import { X } from "lucide-react";

const KEY = "igreen_lgpd_consent_v1";

export function CookieBanner() {
  const [show, setShow] = useState(false);
  useEffect(() => {
    try { if (!localStorage.getItem(KEY)) setShow(true); } catch { /* ignore */ }
  }, []);
  const decide = (v: "accepted" | "rejected") => {
    try { localStorage.setItem(KEY, v); } catch { /* ignore */ }
    setShow(false);
  };
  if (!show) return null;
  return (
    <div className="fixed bottom-0 inset-x-0 z-[100] p-2 sm:p-4 pointer-events-none">
      <div className="pointer-events-auto max-w-3xl mx-auto rounded-xl sm:rounded-2xl border border-primary/30 bg-background/85 backdrop-blur-xl shadow-2xl shadow-primary/10 px-3 py-2 sm:p-5 flex flex-row items-center gap-2 sm:gap-3">
        <p className="text-[11px] leading-snug sm:text-sm text-foreground/90 flex-1 min-w-0">
          Cookies para melhorar sua experiência.{" "}
          <Link to="/politica-privacidade" className="text-primary underline underline-offset-2">Privacidade</Link>.
        </p>
        <div className="flex items-center gap-1 sm:gap-2 shrink-0">
          <Button size="sm" variant="ghost" onClick={() => decide("rejected")} className="text-[11px] sm:text-xs h-7 sm:h-9 px-2 sm:px-3">Rejeitar</Button>
          <Button size="sm" onClick={() => decide("accepted")} className="text-[11px] sm:text-xs h-7 sm:h-9 px-2 sm:px-3">Aceitar</Button>
          <button onClick={() => decide("rejected")} aria-label="Fechar" className="text-muted-foreground hover:text-foreground hidden sm:block">
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
