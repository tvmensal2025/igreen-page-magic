import { useEffect, useState, useRef } from "react";
import { CAPTURE_FIELDS, CaptureFieldKey, useCaptureSession } from "@/hooks/useCaptureSession";
import { useCaptureSuggestions } from "@/hooks/useCaptureSuggestions";
import { CLUB_FIELDS, type ClubFieldKey } from "@/lib/captacao/clubValidation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Check, Edit2, Loader2, X, Bot, Zap, Gift } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { CaptureDocumentTiles } from "./CaptureDocumentTiles";
import { CaptureDataConfirmCard } from "./CaptureDataConfirmCard";
import { CaptureBoletoPreference, resolveBoletoPreference } from "./CaptureBoletoPreference";
import { bumpMission } from "./CaptureMissionsPanel";
import { ProgressRing } from "./ProgressRing";
import { resolvePortalWhatsapp } from "@/lib/captacao/portalPhone";

export type FichaMode = "energia" | "club";

interface Props {
  customerId: string;
  onSubmitted?: () => void;
  embedded?: boolean;
  sentStepsCount?: number;
  /** Botão de ação no rodapé da ficha (ex.: Finalizar cadastro). */
  footer?: React.ReactNode;
  fichaMode?: FichaMode;
  onFichaModeChange?: (mode: FichaMode) => void;
}

export function CaptureLeadCard({
  customerId,
  embedded = false,
  footer,
  fichaMode: fichaModeProp,
  onFichaModeChange,
}: Props) {
  const {
    customer,
    loading,
    filledCount,
    totalFields,
    progress,
    updateField,
    updateBoletoPreference,
    validation,
    idconsultor,
    clubValidation,
    clubFilledCount,
    clubTotalFields,
    clubProgress,
    reload,
    applyCepAutofill,
  } = useCaptureSession(customerId);
  const { suggestions, resolve } = useCaptureSuggestions(customerId);
  const { toast } = useToast();
  const [editing, setEditing] = useState<CaptureFieldKey | null>(null);
  const [editValue, setEditValue] = useState("");
  const [flashKey, setFlashKey] = useState<string | null>(null);
  const [savingBoleto, setSavingBoleto] = useState(false);
  const [lookingCep, setLookingCep] = useState(false);
  const [localMode, setLocalMode] = useState<FichaMode>("energia");
  const lastCountRef = useRef<number>(0);

  const fichaMode = fichaModeProp ?? localMode;
  const setFichaMode = (mode: FichaMode) => {
    onFichaModeChange?.(mode);
    if (fichaModeProp === undefined) setLocalMode(mode);
  };

  const suggestionByField = new Map(suggestions.map((s) => [s.field_name, s]));
  const isClub = fichaMode === "club";

  const acceptSuggestion = async (key: CaptureFieldKey) => {
    const s = suggestionByField.get(key);
    if (!s) return;
    try {
      let value: unknown = s.suggested_value;
      if (key === "electricity_bill_value") value = Number(String(value).replace(",", ".")) || null;
      if (key === "media_consumo") {
        const n = Number(String(value).replace(",", "."));
        value = Number.isFinite(n) && n > 0 ? Math.round(n) : null;
      }
      await updateField(key, value);
      await resolve(s.id, "accepted");
      if (customer?.consultant_id) bumpMission(customer.consultant_id, "aiAccepts");
      toast({ title: `Dado capturado da conversa`, duration: 1500 });
    } catch (e: unknown) {
      toast({
        title: "Erro",
        description: e instanceof Error ? e.message : String(e),
        variant: "destructive",
      });
    }
  };

  useEffect(() => {
    if (loading || !customer) {
      lastCountRef.current = isClub ? clubFilledCount : filledCount;
      return;
    }
    const count = isClub ? clubFilledCount : filledCount;
    const prev = lastCountRef.current;
    if (count > prev && prev >= 0) {
      const fields = isClub ? CLUB_FIELDS : CAPTURE_FIELDS;
      const last = [...fields].reverse().find((f) => {
        if (f.key === "phone_whatsapp") return !!resolvePortalWhatsapp(customer);
        const v = (customer as Record<string, unknown>)[f.key];
        return v !== null && v !== undefined && String(v).trim() !== "";
      });
      if (last) {
        setFlashKey(last.key);
        setTimeout(() => setFlashKey(null), 700);
      }
    }
    lastCountRef.current = count;
  }, [filledCount, clubFilledCount, totalFields, loading, customer, isClub]); // eslint-disable-line

  const startEdit = (key: CaptureFieldKey) => {
    setEditing(key);
    if (key === "phone_whatsapp") {
      setEditValue(resolvePortalWhatsapp(customer) || "");
      return;
    }
    if (key === "portal_idconsultor_override") {
      const override = customer ? (customer as { portal_idconsultor_override?: number | null }).portal_idconsultor_override : null;
      if (override && Number(override) > 0) {
        setEditValue(String(override));
      } else if (idconsultor.id) {
        setEditValue(String(idconsultor.id));
      } else {
        setEditValue("");
      }
      return;
    }
    const v = customer ? (customer as Record<string, unknown>)[key] : "";
    setEditValue(v != null ? String(v) : "");
  };

  const saveEdit = async (overrideValue?: string) => {
    if (!editing) return;
    try {
      let value: unknown = overrideValue !== undefined ? overrideValue : editValue;
      if (editing === "electricity_bill_value") value = Number(String(value).replace(",", ".")) || null;
      if (editing === "media_consumo") {
        const n = Number(String(value).replace(",", "."));
        value = Number.isFinite(n) && n > 0 ? Math.round(n) : null;
      }
      if (editing === "portal_idconsultor_override") {
        value = String(value).replace(/\D/g, "") || null;
      }
      if (editing === "address_state") {
        value = String(value).trim().toUpperCase().slice(0, 2) || null;
      }
      if (editing === "cep") {
        value = String(value).replace(/\D/g, "") || null;
      }
      if (typeof value === "string") value = value.trim() || null;

      // CEP completo → ViaCEP preenche endereço; sobra o número.
      if (editing === "cep" && value && String(value).replace(/\D/g, "").length === 8) {
        setLookingCep(true);
        try {
          const addr = await applyCepAutofill(String(value));
          setEditing(null);
          if (addr) {
            toast({
              title: "Endereço preenchido pelo CEP",
              description: "Confira e informe só o número da residência.",
              duration: 2500,
            });
            setFlashKey("address_number");
            setTimeout(() => setFlashKey(null), 1200);
            setTimeout(() => {
              setEditing("address_number");
              setEditValue(customer?.address_number ? String(customer.address_number) : "");
            }, 50);
          } else {
            await updateField("cep", value);
            toast({
              title: "CEP não encontrado",
              description: "Digite o endereço manualmente.",
              variant: "destructive",
              duration: 2500,
            });
          }
        } finally {
          setLookingCep(false);
        }
        return;
      }

      await updateField(editing, value);
      setEditing(null);
    } catch (e: unknown) {
      toast({
        title: "Erro ao salvar",
        description: e instanceof Error ? e.message : String(e),
        variant: "destructive",
      });
    }
  };

  const saveBoleto = async (next: "unificado" | "separado") => {
    setSavingBoleto(true);
    try {
      await updateBoletoPreference(next);
    } catch (e: unknown) {
      toast({
        title: "Erro ao salvar boleto",
        description: e instanceof Error ? e.message : String(e),
        variant: "destructive",
      });
    } finally {
      setSavingBoleto(false);
    }
  };

  if (loading || !customer) {
    return (
      <div className="p-6 text-center text-sm text-muted-foreground">
        <Loader2 className="w-5 h-5 mx-auto animate-spin" />
      </div>
    );
  }

  const canSubmit = isClub ? !!clubValidation?.ok : !!validation?.ok;
  const firstPending = isClub ? clubValidation?.pendingItems?.[0] : validation?.pendingItems?.[0];
  const ringFilled = isClub ? clubFilledCount : filledCount;
  const ringTotal = isClub ? clubTotalFields : totalFields;
  const ringProgress = isClub ? clubProgress : progress;
  const boletoValue = resolveBoletoPreference(customer);

  const renderFieldRow = (
    f: { key: string; label: string },
    opts: { isIdField?: boolean; optional?: boolean } = {},
  ) => {
    const key = f.key as CaptureFieldKey;
    const isPhoneField = key === "phone_whatsapp";
    const isConsumoField = key === "media_consumo";
    const isCepField = key === "cep";
    const isIdField = !!opts.isIdField || key === "portal_idconsultor_override";
    const v = isPhoneField
      ? resolvePortalWhatsapp(customer)
      : (customer as Record<string, unknown>)[key];
    const displayId = isIdField
      ? (v !== null && v !== undefined && String(v).trim() !== "" && Number(v) > 0
        ? String(v)
        : (idconsultor.id ? String(idconsultor.id) : ""))
      : null;
    const filled = isIdField
      ? !!displayId
      : opts.optional
        ? (v !== null && v !== undefined && String(v).trim() !== "")
        : (v !== null && v !== undefined && String(v).trim() !== ""
          && (key !== "electricity_bill_value" || Number(v) > 0)
          && (!isConsumoField || Number(v) > 0));
    const isEditingThis = editing === key;
    const sugg = !isIdField ? suggestionByField.get(key) : undefined;
    const isFlashing = flashKey === key;
    const idHint =
      idconsultor.source === "parceiro"
        ? `parceiro${idconsultor.partnerName ? `: ${idconsultor.partnerName}` : ""}`
        : idconsultor.source === "override"
          ? "manual"
          : idconsultor.source === "pagina"
            ? "consultor da página"
            : "toque para preencher";
    const emptyHint = isIdField
      ? idHint
      : opts.optional
        ? "opcional"
        : isCepField
          ? "digite o CEP — preenche o resto"
          : key === "address_number"
            ? "número da residência"
            : "toque para preencher";
    const shownValue = isIdField ? displayId : (filled ? String(v) : null);

    return (
      <div
        key={key}
        onClick={() => {
          if (!isEditingThis && !lookingCep) startEdit(key);
        }}
        className={`group cursor-text rounded-md border transition-all px-2 py-1.5 ${
          isFlashing
            ? "border-primary bg-primary/10"
            : sugg
              ? "border-warning/60 bg-warning/5 ring-1 ring-warning/30"
              : filled
                ? "border-primary/25 bg-primary/[0.04] hover:border-primary/40"
                : "border-border/60 bg-background/40 hover:border-primary/30 hover:bg-background"
        }`}
      >
        <div className="flex items-center gap-1.5 min-w-0">
          {lookingCep && isCepField ? (
            <Loader2 className="w-3 h-3 text-primary animate-spin shrink-0" />
          ) : filled ? (
            <Check className="w-3 h-3 text-primary shrink-0" />
          ) : (
            <div className="w-2 h-2 rounded-full border border-muted-foreground/40 shrink-0" />
          )}
          <span className="font-semibold uppercase tracking-wide text-muted-foreground/80 shrink-0 text-[9px] w-[72px]">
            {f.label}
          </span>
          {!isEditingThis && (
            <p
              className={`flex-1 min-w-0 truncate text-[11px] leading-tight ${filled ? "text-foreground font-medium" : "text-muted-foreground/40 italic"}`}
              title={filled ? (isIdField ? `${shownValue} (${idHint})` : String(v)) : undefined}
            >
              {filled ? shownValue : emptyHint}
            </p>
          )}
          {!isEditingThis && isIdField && filled && idconsultor.source !== "override" && (
            <span
              className="text-[8px] uppercase tracking-wide text-muted-foreground/70 shrink-0 max-w-[72px] truncate"
              title={idHint}
            >
              {idconsultor.source === "parceiro" ? "parceiro" : "página"}
            </span>
          )}
          {!isEditingThis && filled && (
            <Edit2 className="w-3 h-3 text-muted-foreground/40 group-hover:text-primary shrink-0 transition" />
          )}
        </div>
        {isEditingThis && (
          <div className="mt-1 flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
            <Input
              value={editValue}
              onChange={(e) => {
                const next =
                  isIdField || isPhoneField || isCepField
                    ? e.target.value.replace(/\D/g, "")
                    : key === "address_state"
                      ? e.target.value.toUpperCase().slice(0, 2)
                      : e.target.value;
                const capped = isCepField ? next.slice(0, 8) : next;
                setEditValue(capped);
                // CEP completo → busca automática (igual SPA oficial)
                if (isCepField && capped.length === 8 && !lookingCep) {
                  void saveEdit(capped);
                }
              }}
              inputMode={
                isIdField || isPhoneField || isCepField || isConsumoField || key === "electricity_bill_value"
                  ? "numeric"
                  : undefined
              }
              maxLength={isCepField ? 8 : undefined}
              placeholder={
                isIdField
                  ? "ID iGreen (opcional)"
                  : isPhoneField
                    ? "DDD + número"
                    : isCepField
                      ? "00000000"
                      : isConsumoField
                        ? "kWh médio"
                        : key === "rg"
                          ? "RG / registro"
                          : key === "address_number"
                            ? "Nº da casa/apto"
                            : undefined
              }
              onKeyDown={(e) => {
                if (e.key === "Enter") void saveEdit();
                if (e.key === "Escape") setEditing(null);
              }}
              autoFocus
              className="h-7 text-xs"
            />
            <Button
              size="icon"
              variant="ghost"
              className="h-7 w-7 shrink-0"
              disabled={lookingCep}
              onClick={() => void saveEdit()}
            >
              {lookingCep && isCepField ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Check className="w-3.5 h-3.5" />
              )}
            </Button>
            <Button size="icon" variant="ghost" className="h-7 w-7 shrink-0" onClick={() => setEditing(null)}>
              <X className="w-3.5 h-3.5" />
            </Button>
          </div>
        )}
        {sugg && !isEditingThis && (
          <div
            className="mt-1 flex items-center gap-1 rounded bg-warning/10 border border-warning/40 px-1 py-0.5"
            onClick={(e) => e.stopPropagation()}
          >
            <Bot className="w-3 h-3 text-warning shrink-0" />
            <span className="text-[10px] flex-1 truncate text-warning dark:text-warning">
              IA: <strong>{sugg.suggested_value}</strong>
            </span>
            <Button
              size="icon"
              variant="ghost"
              className="h-5 w-5 text-primary hover:text-primary"
              onClick={() => void acceptSuggestion(key)}
              title="Aceitar"
            >
              <Check className="w-3 h-3" />
            </Button>
            <Button
              size="icon"
              variant="ghost"
              className="h-5 w-5"
              onClick={() => {
                setEditing(key);
                setEditValue(sugg.suggested_value);
                void resolve(sugg.id, "edited");
              }}
              title="Editar"
            >
              <Edit2 className="w-3 h-3" />
            </Button>
            <Button
              size="icon"
              variant="ghost"
              className="h-5 w-5 text-muted-foreground"
              onClick={() => void resolve(sugg.id, "dismissed")}
              title="Descartar"
            >
              <X className="w-3 h-3" />
            </Button>
          </div>
        )}
      </div>
    );
  };

  return (
    <aside
      className={
        embedded
          ? "w-full h-full flex flex-col bg-transparent overflow-hidden"
          : "w-full h-full min-w-0 shrink-0 flex flex-col bg-card/40 overflow-hidden"
      }
    >
      {/* Alternância Energia (Portal 2) × Club — status e dispatch ficam separados */}
      <div className="flex items-center gap-1 px-2 pt-2 shrink-0">
        <button
          type="button"
          onClick={() => setFichaMode("energia")}
          className={`flex-1 flex items-center justify-center gap-1.5 h-8 rounded-md text-[11px] font-semibold transition ${
            !isClub
              ? "bg-primary text-primary-foreground"
              : "bg-muted/40 text-muted-foreground hover:bg-muted/70"
          }`}
        >
          <Zap className="w-3.5 h-3.5" />
          Energia
        </button>
        <button
          type="button"
          onClick={() => setFichaMode("club")}
          className={`flex-1 flex items-center justify-center gap-1.5 h-8 rounded-md text-[11px] font-semibold transition ${
            isClub
              ? "bg-primary text-primary-foreground"
              : "bg-muted/40 text-muted-foreground hover:bg-muted/70"
          }`}
        >
          <Gift className="w-3.5 h-3.5" />
          Club
        </button>
      </div>

      <div className="flex items-center gap-3 px-3 py-2.5 border-b border-border/60 shrink-0">
        <ProgressRing progress={ringProgress} filled={ringFilled} total={ringTotal} size={48} />
        <div className="min-w-0">
          <p className="text-xs font-semibold text-foreground">
            {canSubmit
              ? isClub
                ? "Club pronto"
                : "Tudo pronto"
              : `${ringFilled} de ${ringTotal} preenchidos`}
          </p>
          <p className="text-[11px] text-muted-foreground truncate">
            {canSubmit
              ? isClub
                ? "Pode cadastrar no Club"
                : "Pode cadastrar"
              : firstPending
                ? `Falta: ${firstPending.label}`
                : "Continue preenchendo"}
          </p>
        </div>
      </div>

      <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
        <div className="overflow-y-auto p-2 space-y-1.5">
          {isClub ? (
            <>
              <p className="text-[10px] text-muted-foreground px-0.5 leading-snug">
                Cadastro PF no iGreen Club. Informe o <strong>CEP</strong> — rua, bairro, cidade e UF
                vêm do ViaCEP. Falta só o <strong>número</strong> da residência.
              </p>
              <div className="flex flex-col gap-1">
                {CLUB_FIELDS.map((f) =>
                  renderFieldRow(f, { optional: !f.required }),
                )}
                {renderFieldRow(
                  { key: "portal_idconsultor_override", label: "ID" },
                  { isIdField: true, optional: true },
                )}
              </div>
            </>
          ) : (
            <>
              <CaptureDataConfirmCard kind="bill" customer={customer} />
              <CaptureDataConfirmCard kind="doc" customer={customer} />
              <div className="flex flex-col gap-1">
                {CAPTURE_FIELDS.filter((f) => f.key !== "document_front_url").map((f) =>
                  renderFieldRow(f),
                )}
              </div>

              <CaptureBoletoPreference
                value={boletoValue}
                saving={savingBoleto}
                onChange={saveBoleto}
              />

              <div className="border-t border-border/60 pt-1.5">
                <CaptureDocumentTiles
                  customerId={customerId}
                  customer={customer}
                  onUploaded={async (key, url) => {
                    await updateField(key as CaptureFieldKey, url);
                  }}
                  onOcrDone={() => { void reload(); }}
                  compact
                />
              </div>
            </>
          )}
        </div>
      </div>

      <div className="border-t border-border shrink-0">{footer}</div>
    </aside>
  );
}

// re-export para quem tipar o modo
export type { ClubFieldKey };
