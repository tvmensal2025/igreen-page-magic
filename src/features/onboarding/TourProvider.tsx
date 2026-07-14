import { useEffect } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { HelpCircle, Play, BookOpen, MessageCircle, RefreshCw, ArrowRight, ArrowLeft, X, ExternalLink, Sparkles } from "lucide-react";
import { useTour } from "./useTour";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

const HIDE_ROUTES = ["/auth", "/tutorial", "/cadastro", "/licenciado", "/proposta", "/r/", "/install", "/reset", "/politica-privacidade", "/crm", "/assistente", "/conexao-"];

export function TourProvider() {
  const location = useLocation();
  const navigate = useNavigate();
  const tour = useTour();
  const { ready, shouldAutoStart, progress, open, current, index, total, start, resume, restart, next, prev, dismiss } = tour;

  useEffect(() => {
    if (!ready) return;
    if (!location.pathname.startsWith("/admin")) return;
    if (shouldAutoStart) {
      const t = setTimeout(() => start(), 500);
      return () => clearTimeout(t);
    }
  }, [ready, shouldAutoStart, location.pathname, start]);

  const isPublic = HIDE_ROUTES.some((p) => location.pathname === p || location.pathname.startsWith(p + "/"));
  if (isPublic && !location.pathname.startsWith("/admin") && location.pathname !== "/ajuda") {
    return null;
  }

  const hasProgress = !!progress && (progress.current_step ?? 0) > 0 && !progress.completed_at;
  const pct = total > 0 ? ((index + 1) / total) * 100 : 0;
  const isLast = index >= total - 1;

  return (
    <>
      {/* Custom tour card — single, polished, unified UI */}
      {open && current && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 w-[92vw] max-w-md animate-in fade-in slide-in-from-bottom-4 duration-300">
          <div className="rounded-2xl border border-primary/20 bg-background shadow-2xl overflow-hidden">
            {/* Header with gradient */}
            <div className="relative bg-gradient-to-br from-primary/10 via-primary/5 to-transparent px-5 pt-4 pb-3">
              <button
                onClick={dismiss}
                className="absolute top-3 right-3 h-7 w-7 rounded-full hover:bg-muted flex items-center justify-center transition"
                aria-label="Fechar"
              >
                <X className="h-4 w-4" />
              </button>
              <div className="flex items-center gap-2 text-xs font-semibold text-primary uppercase tracking-wide">
                <Sparkles className="h-3.5 w-3.5" />
                Tour guiado · {index + 1} de {total}
              </div>
              <h3 className="mt-2 text-lg font-bold leading-tight pr-8">{current.title || `Passo ${current.order_index}`}</h3>
            </div>

            {/* Body */}
            <div className="px-5 py-4 space-y-3">
              <p className="text-sm text-muted-foreground leading-relaxed whitespace-pre-line">
                {current.body || "Conteúdo em preparação."}
              </p>
              {current.cta_href && (
                <a
                  href={current.cta_href}
                  target={current.cta_href.startsWith("http") ? "_blank" : undefined}
                  rel="noreferrer"
                  className="inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline"
                >
                  {current.cta_label || "Saiba mais"}
                  <ExternalLink className="h-3.5 w-3.5" />
                </a>
              )}
            </div>

            {/* Progress bar */}
            <div className="px-5">
              <Progress value={pct} className="h-1.5" />
            </div>

            {/* Footer actions */}
            <div className="px-5 py-3 flex items-center justify-between gap-2 bg-muted/30">
              <Button variant="ghost" size="sm" onClick={dismiss} className="text-muted-foreground">
                Pular tour
              </Button>
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" onClick={prev} disabled={index === 0}>
                  <ArrowLeft className="h-4 w-4 mr-1" /> Voltar
                </Button>
                <Button size="sm" onClick={next}>
                  {isLast ? "Concluir" : "Próximo"}
                  {!isLast && <ArrowRight className="h-4 w-4 ml-1" />}
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Floating help button */}
      <div className="fixed bottom-6 right-6 z-40" data-tour="help-fab">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              size="lg"
              className="h-14 w-14 rounded-full shadow-2xl hover:scale-105 transition-transform bg-primary hover:bg-primary/90"
              aria-label="Ajuda"
            >
              <HelpCircle className="h-6 w-6" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-64">
            <DropdownMenuLabel>Precisa de ajuda?</DropdownMenuLabel>
            <DropdownMenuSeparator />
            {hasProgress && (
              <DropdownMenuItem onClick={resume}>
                <Play className="h-4 w-4 mr-2" /> Continuar tour
              </DropdownMenuItem>
            )}
            <DropdownMenuItem onClick={restart}>
              <RefreshCw className="h-4 w-4 mr-2" /> {hasProgress ? "Reiniciar tour" : "Fazer tour completo"}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => navigate("/ajuda")}>
              <BookOpen className="h-4 w-4 mr-2" /> Central de Ajuda
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={() => window.dispatchEvent(new CustomEvent("open-support-chat"))}
            >
              <MessageCircle className="h-4 w-4 mr-2" /> Falar com suporte
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </>
  );
}
