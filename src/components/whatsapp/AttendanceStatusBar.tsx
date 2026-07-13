import { CheckCircle2, Copy, Loader2, PlayCircle, RotateCcw, Settings, Star } from "lucide-react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";

export type AttendanceUiState =
  | "not_started"
  | "in_progress"
  | "awaiting_rating"
  | "rated";

interface AttendanceStatusBarProps {
  state: AttendanceUiState;
  protocol?: string | null;
  rating?: number | null;
  starting?: boolean;
  ending?: boolean;
  onStart: () => void;
  onRequestEnd: () => void;
  onRestart?: () => void;
  compact?: boolean;
}

function Stars({ rating }: { rating: number }) {
  return (
    <span className="inline-flex items-center gap-0.5" aria-label={`Nota ${rating} de 5`}>
      {Array.from({ length: 5 }, (_, i) => (
        <Star
          key={i}
          className={`h-3 w-3 ${i < rating ? "fill-amber-400 text-amber-500" : "text-muted-foreground/35"}`}
        />
      ))}
    </span>
  );
}

export function AttendanceStatusBar({
  state,
  protocol,
  rating,
  starting,
  ending,
  onStart,
  onRequestEnd,
  onRestart,
  compact,
}: AttendanceStatusBarProps) {
  const { toast } = useToast();

  const copyProtocol = async () => {
    if (!protocol) return;
    try {
      await navigator.clipboard.writeText(protocol);
      toast({ title: "Protocolo copiado", description: protocol });
    } catch {
      toast({ title: "Não deu pra copiar", variant: "destructive" });
    }
  };

  if (state === "not_started") {
    return (
      <div className="flex items-center gap-1 shrink-0">
        <Button
          size="sm"
          onClick={onStart}
          disabled={starting}
          className="h-8 gap-1.5 px-3 rounded-full bg-emerald-600 hover:bg-emerald-500 text-white shadow-sm shadow-emerald-600/30 shrink-0"
          title="Envia saudação + protocolo e pede o nome"
        >
          {starting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <PlayCircle className="h-3.5 w-3.5" />}
          <span className="text-[11px] font-semibold hidden sm:inline">Iniciar atendimento</span>
          <span className="text-[11px] font-semibold sm:hidden">Iniciar</span>
        </Button>
        <Button
          asChild
          size="icon"
          variant="ghost"
          className="h-8 w-8 rounded-full text-muted-foreground hover:text-foreground"
          title="Personalizar a mensagem de abrir chamado"
        >
          <Link to="/consultor/mensagens"><Settings className="h-3.5 w-3.5" /></Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-1.5 shrink-0 min-w-0">
      {state === "in_progress" && (
        <Button
          size="sm"
          variant="outline"
          onClick={onRequestEnd}
          disabled={ending}
          className="h-8 gap-1.5 px-3 rounded-full border-amber-500/40 text-amber-700 hover:bg-amber-500/10 shrink-0"
          title="Envia encerramento e pesquisa de satisfação (1 a 5)"
        >
          {ending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Star className="h-3.5 w-3.5" />}
          <span className="text-[11px] font-semibold hidden sm:inline">Finalizar</span>
        </Button>
      )}

      {(state === "awaiting_rating" || state === "rated") && onRestart && (
        <Button
          size="sm"
          variant="outline"
          onClick={onRestart}
          disabled={starting}
          className="h-8 gap-1.5 px-3 rounded-full border-emerald-500/40 text-emerald-700 hover:bg-emerald-500/10 shrink-0"
          title="Recomeça o atendimento (novo protocolo) mesmo sem a nota do cliente"
        >
          {starting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RotateCcw className="h-3.5 w-3.5" />}
          <span className="text-[11px] font-semibold hidden sm:inline">Reiniciar</span>
        </Button>
      )}

      <span
        className={`inline-flex items-center gap-1.5 h-7 max-w-[min(100%,16rem)] px-2 rounded-full border shrink-0 ${
          state === "rated"
            ? "bg-amber-500/10 text-amber-700 border-amber-500/30"
            : state === "awaiting_rating"
            ? "bg-sky-500/10 text-sky-700 border-sky-500/30"
            : "bg-emerald-500/10 text-emerald-600 border-emerald-500/25"
        }`}
        title={
          state === "rated"
            ? `Avaliação ${rating}/5`
            : state === "awaiting_rating"
            ? "Aguardando avaliação do cliente"
            : protocol
            ? `Protocolo ${protocol}`
            : "Atendimento iniciado"
        }
      >
        {state === "rated" && typeof rating === "number" ? (
          <>
            <Stars rating={rating} />
            {!compact && (
              <span className="text-[10px] font-semibold hidden md:inline">{rating}/5</span>
            )}
          </>
        ) : (
          <>
            <CheckCircle2 className="h-3 w-3 shrink-0" />
            <span className="text-[10px] font-semibold truncate hidden md:inline">
              {state === "awaiting_rating"
                ? "Aguardando nota"
                : protocol
                ? `Atendimento · ${protocol}`
                : "Atendimento iniciado"}
            </span>
            <span className="text-[10px] font-semibold md:hidden">
              {state === "awaiting_rating" ? "Nota?" : "Iniciado"}
            </span>
          </>
        )}
        {protocol && (
          <button
            type="button"
            onClick={() => void copyProtocol()}
            className="ml-0.5 p-0.5 rounded hover:bg-background/60 text-current/70 hover:text-current"
            title={`Copiar protocolo ${protocol}`}
            aria-label="Copiar protocolo"
          >
            <Copy className="h-3 w-3" />
          </button>
        )}
      </span>
    </div>
  );
}
