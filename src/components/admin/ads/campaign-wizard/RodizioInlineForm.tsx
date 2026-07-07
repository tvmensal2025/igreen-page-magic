/**
 * RodizioInlineForm — formulário (apenas apresentação) para criar um
 * participante do rodízio direto no wizard. Suporta os dois tipos:
 *   - CONSULTOR: exige `partner_igreen_id` (código iGreen). `cli` é opcional.
 *   - PARCEIRO/INDICADOR: exige `cli`. Não tem `partner_igreen_id`.
 *
 * Este componente NÃO contém lógica de validação/criação: ela mora no hook
 * `useRodizioLogic` (Tarefa 12.1). Aqui só renderizamos os campos, disparamos
 * os callbacks de mudança/submit/cancelamento e exibimos as mensagens de erro
 * recebidas via props.
 */
import { Loader2, UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import type { RodizioInlineForm as RodizioInlineFormValue } from "./hooks/useWizardState";

/** Mensagens de validação por campo (preenchidas pelo hook). */
export interface RodizioInlineFormErrors {
  nome?: string;
  notification_phone?: string;
  partner_igreen_id?: string;
  cli?: string;
}

interface Props {
  /** Valores atuais do form (controlado pelo estado do wizard). */
  value: RodizioInlineFormValue;
  /** Aplica uma mudança parcial nos campos do form. */
  onChange: (patch: Partial<RodizioInlineFormValue>) => void;
  /** Dispara a tentativa de salvar (a validação/criação fica no hook). */
  onSubmit: () => void;
  /** Fecha/cancela o form inline. */
  onCancel: () => void;
  /** Indica que a criação está em andamento (desabilita os controles). */
  submitting?: boolean;
  /** Mensagens de erro por campo, exibidas abaixo de cada input. */
  errors?: RodizioInlineFormErrors;
}

/** Texto de erro padronizado abaixo de um campo. */
function FieldError({ message }: { message?: string }) {
  if (!message) return null;
  return <p className="text-[11px] text-destructive mt-1">{message}</p>;
}

export function RodizioInlineForm({
  value,
  onChange,
  onSubmit,
  onCancel,
  submitting = false,
  errors = {},
}: Props) {
  const isConsultor = value.tipo === "consultor";

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (submitting) return;
    onSubmit();
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="rounded-lg border border-[hsl(var(--ads-border))] bg-muted/30 p-3 space-y-3"
    >
      <div className="flex items-center gap-1.5 text-sm font-semibold">
        <UserPlus className="w-4 h-4 text-[hsl(var(--ads-emerald-2))]" />
        Novo participante
      </div>

      {/* Tipo do participante */}
      <div className="space-y-1.5">
        <Label>Tipo</Label>
        <RadioGroup
          className="grid-cols-2"
          value={value.tipo}
          onValueChange={(tipo) =>
            onChange({ tipo: tipo as RodizioInlineFormValue["tipo"] })
          }
          disabled={submitting}
        >
          <label
            htmlFor="rodizio-tipo-consultor"
            className={`flex items-center gap-2 rounded-md border px-3 py-2 text-xs cursor-pointer ${
              isConsultor
                ? "border-[hsl(var(--ads-emerald-2))] bg-primary/5"
                : "border-[hsl(var(--ads-border))]"
            }`}
          >
            <RadioGroupItem value="consultor" id="rodizio-tipo-consultor" />
            <span>
              <span className="font-semibold block">Consultor</span>
              <span className="text-[hsl(var(--ads-muted))]">tem código iGreen</span>
            </span>
          </label>
          <label
            htmlFor="rodizio-tipo-parceiro"
            className={`flex items-center gap-2 rounded-md border px-3 py-2 text-xs cursor-pointer ${
              !isConsultor
                ? "border-[hsl(var(--ads-emerald-2))] bg-primary/5"
                : "border-[hsl(var(--ads-border))]"
            }`}
          >
            <RadioGroupItem value="parceiro" id="rodizio-tipo-parceiro" />
            <span>
              <span className="font-semibold block">Parceiro/Indicador</span>
              <span className="text-[hsl(var(--ads-muted))]">entra como indicador</span>
            </span>
          </label>
        </RadioGroup>
      </div>

      {/* Nome (ambos) */}
      <div>
        <Label htmlFor="rodizio-nome">Nome</Label>
        <Input
          id="rodizio-nome"
          value={value.nome}
          onChange={(e) => onChange({ nome: e.target.value })}
          placeholder="Nome do participante"
          disabled={submitting}
          aria-invalid={!!errors.nome}
        />
        <FieldError message={errors.nome} />
      </div>

      {/* Telefone de aviso (ambos) */}
      <div>
        <Label htmlFor="rodizio-telefone">📱 WhatsApp de aviso</Label>
        <Input
          id="rodizio-telefone"
          value={value.notification_phone}
          onChange={(e) => onChange({ notification_phone: e.target.value })}
          placeholder="Ex.: 11 99999-8888"
          inputMode="tel"
          disabled={submitting}
          aria-invalid={!!errors.notification_phone}
        />
        <p className="text-[11px] text-[hsl(var(--ads-muted))] mt-1">
          Este WhatsApp recebe uma mensagem cada vez que chegar um lead deste anúncio.
        </p>
        <FieldError message={errors.notification_phone} />
      </div>

      {/* Campos específicos do tipo */}
      {isConsultor ? (
        <>
          <div>
            <Label htmlFor="rodizio-igreen">🆔 Código iGreen</Label>
            <Input
              id="rodizio-igreen"
              value={value.partner_igreen_id}
              onChange={(e) => onChange({ partner_igreen_id: e.target.value })}
              placeholder="Código iGreen do consultor"
              inputMode="numeric"
              disabled={submitting}
              aria-invalid={!!errors.partner_igreen_id}
            />
            <FieldError message={errors.partner_igreen_id} />
          </div>
          <div>
            <Label htmlFor="rodizio-cli-opt">
              Código de indicação{" "}
              <span className="text-[hsl(var(--ads-muted))]">(opcional — cli)</span>
            </Label>
            <Input
              id="rodizio-cli-opt"
              value={value.cli}
              onChange={(e) => onChange({ cli: e.target.value })}
              placeholder="Deixe vazio se não tiver"
              inputMode="numeric"
              disabled={submitting}
              aria-invalid={!!errors.cli}
            />
            <FieldError message={errors.cli} />
          </div>
        </>
      ) : (
        <div>
          <Label htmlFor="rodizio-cli">🔢 Código de indicação</Label>
          <Input
            id="rodizio-cli"
            value={value.cli}
            onChange={(e) => onChange({ cli: e.target.value })}
            placeholder="Código do parceiro (no iGreen aparece como cli)"
            inputMode="numeric"
            disabled={submitting}
            aria-invalid={!!errors.cli}
          />
          <FieldError message={errors.cli} />
        </div>
      )}


      {/* Ações */}
      <div className="flex items-center justify-end gap-2 pt-1">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onCancel}
          disabled={submitting}
        >
          Cancelar
        </Button>
        <Button type="submit" size="sm" disabled={submitting}>
          {submitting && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
          Salvar participante
        </Button>
      </div>
    </form>
  );
}
