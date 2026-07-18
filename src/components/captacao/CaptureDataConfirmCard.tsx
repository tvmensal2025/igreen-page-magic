import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Check, Edit2, MessageCircle, Loader2, X, FileText, IdCard } from "lucide-react";
// Nota: `Check` ainda é usado nos ícones inline dos campos editáveis.


type FieldDef = { key: string; label: string; format?: (v: any) => string };

interface Props {
  kind: "bill" | "doc";
  customer: any;
  onConfirmed?: () => void;
}

const BILL_FIELDS: FieldDef[] = [
  { key: "bill_holder_name", label: "Titular" },
  { key: "numero_instalacao", label: "Instalação" },
  { key: "distribuidora", label: "Distribuidora" },
  { key: "cep", label: "CEP" },
  { key: "address_street", label: "Rua" },
  { key: "address_number", label: "Nº" },
  { key: "address_neighborhood", label: "Bairro" },
  { key: "address_city", label: "Cidade" },
  { key: "address_state", label: "UF" },
];
const DOC_FIELDS: FieldDef[] = [
  { key: "doc_holder_name", label: "Nome (documento)" },
  { key: "cpf", label: "CPF" },
  { key: "rg", label: "RG" },
  { key: "data_nascimento", label: "Nascimento" },
  { key: "nome_mae", label: "Mãe" },
];


function hasAny(customer: any, fields: FieldDef[]) {
  return fields.some((f) => {
    const v = customer?.[f.key];
    return v !== null && v !== undefined && String(v).trim() !== "";
  });
}

export function CaptureDataConfirmCard({ kind, customer, onConfirmed }: Props) {
  const { toast } = useToast();
  const fields = kind === "bill" ? BILL_FIELDS : DOC_FIELDS;
  const confirmedAt = kind === "bill" ? customer?.bill_data_confirmed_at : customer?.doc_data_confirmed_at;
  const [editing, setEditing] = useState<string | null>(null);
  const [editVal, setEditVal] = useState("");
  const [busy, setBusy] = useState<"" | "self" | "client">("");

  if (!hasAny(customer, fields)) return null; // sem OCR ainda
  const isConfirmed = !!confirmedAt;

  const title = kind === "bill" ? "📄 Dados lidos da CONTA" : "🪪 Dados lidos do DOCUMENTO";
  const Icon = kind === "bill" ? FileText : IdCard;
  const tone = isConfirmed
    ? "border-primary/50 bg-primary/5"
    : kind === "bill" ? "border-warning/60 bg-warning/5" : "border-info/60 bg-info/5";

  const saveEdit = async () => {
    if (!editing) return;
    try {
      await supabase.from("customers").update({ [editing]: editVal.trim() || null } as never).eq("id", customer.id);
      setEditing(null);
    } catch (e: any) {
      toast({ title: "Erro", description: e?.message || String(e), variant: "destructive" });
    }
  };

  // confirmSelf removido (2026-07-18): a confirmação SEMPRE é feita pelo cliente
  // no WhatsApp. O consultor não confirma mais dados de OCR pelo painel.


  const askClient = async () => {
    setBusy("client");
    try {
      // ✅ UNIFICADO (2026-05-28): usa o MESMO pipeline do OcrReviewCard.askClient
      // — invoca `manual-step-send` para o step legacy `confirmando_dados_conta` /
      // `confirmando_dados_doc`, que renderiza o template bonito com botões
      // interativos `✅ SIM` / `❌ NÃO` / `✏️ EDITAR`.
      //
      // ANTES: enviava texto puro via whapi-proxy/send_text com instrução
      // "Responda SIM" — o cliente recebia mensagem feia sem botões.
      //
      // Importante: NÃO zera ocr_review_pending ainda, deixa esse trabalho
      // pra `manual-step-send`. Isso evita race com o OcrReviewBanner que
      // checa ocr_review_pending no momento de abrir o modal.
      const stepKey = kind === "bill" ? "confirmando_dados_conta" : "confirmando_dados_doc";
      await supabase.from("customers").update({
        [kind === "bill" ? "bill_data_confirmation_by" : "doc_data_confirmation_by"]: "awaiting_client",
        ocr_review_pending: null,
        ocr_review_decided_at: new Date().toISOString(),
        ocr_review_decided_by: "awaiting_client",
        // Volta o step pro pipeline legado mandar a confirmação ao cliente.
        conversation_step: stepKey,
      } as any).eq("id", customer.id);

      const { data, error } = await supabase.functions.invoke("manual-step-send", {
        body: {
          consultantId: customer.consultant_id,
          customerId: customer.id,
          stepKey,
          part: "all",
          continueFlow: false,
          skipNameGuard: true,
        },
      });
      if (error || (data as any)?.error) throw new Error((data as any)?.error || error?.message || "Falha ao enviar");
      toast({ title: "📩 Enviado ao cliente", description: "Aguardando confirmação no WhatsApp", duration: 2200 });
    } catch (e: any) {
      toast({ title: "Erro", description: e?.message || String(e), variant: "destructive" });
    } finally { setBusy(""); }
  };

  const awaiting = (kind === "bill" ? customer?.bill_data_confirmation_by : customer?.doc_data_confirmation_by) === "awaiting_client";

  return (
    <div className={`rounded-md border ${tone} px-1.5 py-1 space-y-0.5 animate-in fade-in slide-in-from-top-1`}>
      <div className="flex items-center gap-1">
        <Icon className="w-3 h-3 text-warning" />
        <span className="text-[10px] font-bold uppercase tracking-wide truncate">{title}</span>
        {isConfirmed && (
          <span className="ml-auto text-[9px] px-1.5 py-px rounded-full bg-primary/100 text-white font-bold shadow-sm">
            Confirmado ✓
          </span>
        )}
        {!isConfirmed && awaiting && (
          <span className="ml-auto text-[8px] px-1 py-px rounded-full bg-warning/20 text-warning dark:text-warning font-bold animate-pulse">
            aguardando
          </span>
        )}
      </div>

      <div className="space-y-0.5">
        {fields.map((f) => {
          const v = customer?.[f.key];
          const filled = v !== null && v !== undefined && String(v).trim() !== "";
          if (!filled) return null;
          const isEditing = editing === f.key;
          return (
            <div key={f.key} className="flex items-baseline gap-1.5 min-w-0 text-[10px] leading-snug">
              <span className="text-muted-foreground shrink-0 w-14 text-right">{f.label}:</span>
              {isEditing ? (
                <>
                  <Input
                    value={editVal}
                    onChange={(e) => setEditVal(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") void saveEdit(); if (e.key === "Escape") setEditing(null); }}
                    autoFocus
                    className="h-5 text-[10px] px-1 flex-1 min-w-0"
                  />
                  <button onClick={() => void saveEdit()} className="text-primary shrink-0"><Check className="w-2.5 h-2.5" /></button>
                  <button onClick={() => setEditing(null)} className="text-muted-foreground shrink-0"><X className="w-2.5 h-2.5" /></button>
                </>
              ) : (
                <>
                  <span className="flex-1 min-w-0 break-words font-semibold" title={String(v)}>{String(v)}</span>
                  {!isConfirmed && (
                    <button onClick={() => { setEditing(f.key); setEditVal(String(v)); }} className="opacity-60 hover:opacity-100 shrink-0">
                      <Edit2 className="w-2.5 h-2.5" />
                    </button>
                  )}
                </>
              )}
            </div>
          );
        })}
      </div>

      {!isConfirmed && (
        <div className="flex items-center gap-1 pt-0.5">
          {/* 2026-07-18: só o cliente confirma — botão "Confirmo" do consultor
              foi removido. O bot já mandou os botões SIM/NÃO/EDITAR no WhatsApp
              logo após o OCR; este botão só re-envia o pedido caso o cliente
              não tenha respondido. */}
          <Button size="sm" variant="outline" className="h-6 w-full text-[10px] gap-1 px-1.5" onClick={() => void askClient()} disabled={busy !== ""} title="Reenviar pedido de confirmação ao cliente via WhatsApp">
            {busy === "client" ? <Loader2 className="w-2.5 h-2.5 animate-spin" /> : <MessageCircle className="w-2.5 h-2.5" />}
            <span className="truncate">Reenviar ao cliente</span>
          </Button>
        </div>
      )}
    </div>
  );
}
