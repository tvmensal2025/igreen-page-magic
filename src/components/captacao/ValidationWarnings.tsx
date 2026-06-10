import { AlertTriangle, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { ValidationResult } from "@/lib/captacao/portalValidation";

interface Props {
  validation?: ValidationResult;
  onApplySuggestion?: (field: string, value: any) => void;
}

/**
 * Banner que aparece no rodapé da captação quando algum campo está
 * INVÁLIDO (preenchido, mas errado pro portal). Mostra o motivo em
 * linguagem natural e — quando aplicável — um botão pra usar a
 * sugestão (ex: consumo estimado a partir do valor da conta).
 *
 * Quando vazio, não renderiza nada (consultor vê só o botão CADASTRAR).
 */
export function ValidationWarnings({ validation, onApplySuggestion }: Props) {
  if (!validation || validation.invalid.length === 0) return null;
  return (
    <div className="mx-2 mb-1.5 rounded-md border border-warning/50 px-2 py-1.5 text-[11px] space-y-1 text-primary bg-destructive/10">
      {validation.invalid.map((i, idx) => (
        <div key={idx} className="flex items-start gap-1.5">
          <AlertTriangle className="w-3.5 h-3.5 mt-px shrink-0 text-warning" />
          <div className="flex-1 leading-snug">
            <strong className="block">{i.label}</strong>
            <span className="opacity-90">{i.reason}</span>
            {i.suggestion !== undefined && onApplySuggestion && (
              <div className="mt-1">
                <Button
                  size="sm"
                  variant="outline"
                  className="h-6 px-2 text-[10px] gap-1 border-warning/60 bg-warning/10 hover:bg-warning/20"
                  onClick={() => onApplySuggestion(
                    i.field === "consumo_vs_valor" ? "media_consumo" : String(i.field),
                    i.suggestion,
                  )}
                >
                  <Sparkles className="w-3 h-3" />
                  Usar sugestão: {String(i.suggestion)}
                </Button>
              </div>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
