import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { HelpCircle, Play, BookOpen, MessageCircle, RefreshCw, X } from "lucide-react";
import { useTour } from "./useTour";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
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
  const { ready, shouldAutoStart, progress, start, resume, restart } = useTour();
  const [welcomeOpen, setWelcomeOpen] = useState(false);

  // Auto-open welcome dialog on first login (only inside /admin area)
  useEffect(() => {
    if (!ready) return;
    if (!location.pathname.startsWith("/admin")) return;
    if (shouldAutoStart) setWelcomeOpen(true);
  }, [ready, shouldAutoStart, location.pathname]);

  // Hide FAB on public routes
  const isPublic = HIDE_ROUTES.some((p) => location.pathname === p || location.pathname.startsWith(p + "/") || (p.endsWith("/") && location.pathname.startsWith(p)));
  if (isPublic && !location.pathname.startsWith("/admin") && location.pathname !== "/ajuda") {
    return null;
  }

  const hasProgress = !!progress && (progress.current_step ?? 0) > 0 && !progress.completed_at;

  return (
    <>
      {/* Welcome dialog on first login */}
      <Dialog open={welcomeOpen} onOpenChange={setWelcomeOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="text-2xl">👋 Bem-vindo à plataforma!</DialogTitle>
            <DialogDescription className="text-base pt-2">
              Que tal um tour rápido de <strong>5 minutos</strong>? Vou te mostrar as principais funções na tela real,
              destacando cada botão. Você aprende sem precisar ler manual.
            </DialogDescription>
          </DialogHeader>
          <div className="rounded-xl bg-muted/40 p-3 text-sm space-y-1">
            <div>✓ Como conectar o WhatsApp e ligar o robô</div>
            <div>✓ Kanban do CRM, Captação, Conversão</div>
            <div>✓ Motor de Cadência (o robô que nunca deixa lead esfriar)</div>
            <div>✓ Meta Ads, Hub de textos, Automações</div>
          </div>
          <DialogFooter className="gap-2 sm:gap-2">
            <Button variant="ghost" onClick={() => setWelcomeOpen(false)}>Depois</Button>
            <Button onClick={() => { setWelcomeOpen(false); start(); }}>
              <Play className="h-4 w-4 mr-2" /> Começar tour
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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
