/**
 * RodizioBlock — bloco do Step 4 (StepBudget) que liga/desliga o rodízio de
 * leads e configura os participantes. Apenas apresentação: TODA a lógica
 * (carregar/criar participantes, validar, adicionar/remover, mínimo de 2) mora
 * no hook `useRodizioLogic`.
 *
 * Estrutura:
 *   - Toggle (Switch) "Distribuir leads entre vários participantes (rodízio)";
 *   - Quando ligado: multi-select de participantes existentes (Combobox) +
 *     lista ordenada (com remover) + botões de criar participante + form inline.
 *
 * Limite do projeto: ≤ 250 linhas. Por isso a regra de negócio fica no hook.
 */
import { useState } from "react";
import { Users, UserPlus, X, AlertTriangle, Loader2 } from "lucide-react";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Combobox, type ComboboxOption } from "@/components/ui/combobox";
import { RodizioInlineForm, type RodizioInlineFormErrors } from "./RodizioInlineForm";
import { useRodizioLogic, validateInlineForm } from "./hooks/useRodizioLogic";
import type { WizardState, RodizioInlineForm as RodizioInlineFormValue } from "./hooks/useWizardState";

interface Props {
  /** Wizard aberto? Usado pelo hook para carregar/limpar participantes. */
  open: boolean;
  state: WizardState;
  patch: (p: Partial<WizardState>) => void;
  patchFn: (fn: (prev: WizardState) => Partial<WizardState>) => void;
}

/**
 * Converte a lista de erros com `field` no shape esperado pelo form.
 * Fonte única de verdade da validação continua no hook — sem substring match.
 */
function mapInlineErrors(form: RodizioInlineFormValue): RodizioInlineFormErrors {
  const errors: RodizioInlineFormErrors = {};
  for (const err of validateInlineForm(form)) {
    errors[err.field] = err.message;
  }
  return errors;
}


export function RodizioBlock({ open, state, patch, patchFn }: Props) {
  const {
    availablePartners,
    creating,
    minParticipantsError,
    setRodizioEnabled,
    addPartner,
    removePartner,
    openInlineForm,
    closeInlineForm,
    updateInlineForm,
    submitInlineForm,
  } = useRodizioLogic({ open, state, patch, patchFn });

  // Só mostramos os erros por campo depois de uma tentativa de salvar, para não
  // "gritar" com o usuário antes de ele preencher.
  const [triedSubmit, setTriedSubmit] = useState(false);

  const { rodizioEnabled, rodizioPartners, rodizioPartnersLoading, rodizioInlineForm } = state;

  // Opções do multi-select: participantes existentes do dono.
  const options: ComboboxOption[] = availablePartners.map((p) => ({
    value: p.id,
    label: p.nome,
    hint: p.tipo === "consultor" ? "Consultor" : "Parceiro",
  }));

  // A lista ordenada é a fonte de verdade; o combobox só reflete os ids dela.
  const selectedIds = rodizioPartners.map((p) => p.id);

  /** Traduz a mudança do combobox em add/remove na lista ordenada. */
  function handleComboChange(next: string[]) {
    const added = next.find((id) => !selectedIds.includes(id));
    if (added) {
      const partner = availablePartners.find((p) => p.id === added);
      if (partner) addPartner(partner);
      return;
    }
    const removed = selectedIds.find((id) => !next.includes(id));
    if (removed) removePartner(removed);
  }

  function handleSubmitInline() {
    setTriedSubmit(true);
    void submitInlineForm();
  }

  function handleOpenInline(tipo: RodizioInlineFormValue["tipo"]) {
    setTriedSubmit(false);
    openInlineForm(tipo);
  }

  function handleCancelInline() {
    setTriedSubmit(false);
    closeInlineForm();
  }

  return (
    <div className="rounded-lg border border-[hsl(var(--ads-border))] overflow-hidden">
      {/* Cabeçalho com o toggle */}
      <div className="flex items-center justify-between gap-3 px-3 py-2.5">
        <Label
          htmlFor="rodizio-toggle"
          className="flex items-center gap-2 text-sm font-semibold cursor-pointer"
        >
          <Users className="w-4 h-4 text-[hsl(var(--ads-emerald-2))]" />
          Distribuir leads entre vários participantes (rodízio)
        </Label>
        <Switch
          id="rodizio-toggle"
          checked={rodizioEnabled}
          onCheckedChange={setRodizioEnabled}
        />
      </div>

      {/* Bloco de participantes (só quando ligado) */}
      {rodizioEnabled && (
        <div className="px-3 pb-3 space-y-3 border-t border-[hsl(var(--ads-border))] pt-3">
          <p className="text-[11px] text-[hsl(var(--ads-muted))]">
            Os leads deste anúncio são repartidos em ordem circular entre os
            participantes abaixo. A conversa continua no número central.
          </p>

          {/* Multi-select de participantes existentes */}
          <div className="space-y-1.5">
            <Label className="text-xs">Participantes existentes</Label>
            <Combobox
              multiple
              options={options}
              value={selectedIds}
              onChange={handleComboChange}
              placeholder={rodizioPartnersLoading ? "Carregando..." : "Selecione participantes..."}
              searchPlaceholder="Buscar participante..."
              emptyText={rodizioPartnersLoading ? "Carregando..." : "Nenhum participante encontrado."}
              disabled={rodizioPartnersLoading}
            />
          </div>

          {/* Lista ordenada dos participantes selecionados */}
          {rodizioPartners.length > 0 && (
            <ol className="space-y-1.5">
              {rodizioPartners.map((p, idx) => (
                <li
                  key={p.id}
                  className="flex items-center gap-2 rounded-md border border-[hsl(var(--ads-border))] bg-muted/30 px-2.5 py-1.5"
                >
                  <span className="ads-num text-xs font-semibold text-[hsl(var(--ads-emerald-2))] w-5 text-center">
                    {idx + 1}
                  </span>
                  <span className="flex-1 text-sm truncate">{p.nome}</span>
                  <span className="text-[10px] uppercase tracking-wide text-[hsl(var(--ads-muted))]">
                    {p.tipo === "consultor" ? "Consultor" : "Parceiro"}
                  </span>
                  <button
                    type="button"
                    onClick={() => removePartner(p.id)}
                    className="text-[hsl(var(--ads-muted))] hover:text-destructive"
                    aria-label={`Remover ${p.nome}`}
                  >
                    <X className="w-4 h-4" />
                  </button>
                </li>
              ))}
            </ol>
          )}

          {/* Aviso de mínimo de 2 participantes (Requisito 5.2) */}
          {minParticipantsError && (
            <div className="flex items-center gap-1.5 text-[11px] text-warning">
              <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
              {minParticipantsError}
            </div>
          )}

          {/* Form inline de criação ou botões para abri-lo */}
          {rodizioInlineForm ? (
            <RodizioInlineForm
              value={rodizioInlineForm}
              onChange={updateInlineForm}
              onSubmit={handleSubmitInline}
              onCancel={handleCancelInline}
              submitting={creating}
              errors={triedSubmit ? mapInlineErrors(rodizioInlineForm) : {}}
            />
          ) : (
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => handleOpenInline("consultor")}
                disabled={rodizioPartnersLoading}
              >
                {rodizioPartnersLoading ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <UserPlus className="w-3.5 h-3.5" />
                )}
                Criar participante
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
