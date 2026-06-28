// OcrReviewCard — card grande que aparece no painel quando o bot terminou o OCR
// e o consultor está online. Mostra a foto da conta/documento ao lado dos
// dados extraídos e dois botões grandes: "Eu confirmo" / "Pedir ao cliente".
//
// Aparece com pulse + sound pra chamar atenção do consultor que pode estar
// olhando outra aba. Auto-timeout de 5 min: se o consultor não decidir,
// o bot segue automaticamente pro caminho "cliente confirma no chat".

import { useState, useEffect, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Check, MessageCircle, Edit2, X, Loader2, AlertCircle, FileText, IdCard, Clock } from "lucide-react";
import { haptics } from "@/lib/haptics";
import { dispatchPostBillConfirm } from "@/lib/captacao/postBillConfirm";


type FieldDef = { key: string; label: string };

const BILL_FIELDS: FieldDef[] = [
  { key: "bill_holder_name", label: "Titular" },
  { key: "numero_instalacao", label: "Instalação" },
  { key: "distribuidora", label: "Distribuidora" },
  { key: "electricity_bill_value", label: "Valor (R$)" },
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


interface Props {
  customer: any;
  /** "bill" | "doc" — qual review está pendente. Vem de customers.ocr_review_pending. */
  kind: "bill" | "doc";
  /** Callback quando o consultor decide algo (confirma ou manda pro cliente). */
  onDecided?: () => void;
}

const TIMEOUT_MS = 60 * 1000; // 1 min — após isso, cron libera para o cliente

export function OcrReviewCard({ customer, kind, onDecided }: Props) {
  const { toast } = useToast();
  const fields = kind === "bill" ? BILL_FIELDS : DOC_FIELDS;
  const photoUrl = kind === "bill" ? customer?.electricity_bill_photo_url : customer?.document_front_url;
  const startedAt = customer?.ocr_review_started_at ? new Date(customer.ocr_review_started_at).getTime() : Date.now();
  const [editing, setEditing] = useState<string | null>(null);
  const [editVal, setEditVal] = useState("");
  const [busy, setBusy] = useState<"" | "self" | "client">("");
  const [now, setNow] = useState(Date.now());

  // Tick de 1s pra mostrar o countdown.
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  // Vibração + ping ao montar (chama atenção do consultor).
  useEffect(() => {
    haptics.click();
  }, [customer?.id, kind]);

  const elapsedMs = now - startedAt;
  const remainingMs = Math.max(0, TIMEOUT_MS - elapsedMs);
  const timeoutPct = Math.max(0, Math.min(100, (remainingMs / TIMEOUT_MS) * 100));
  const remainingMin = Math.floor(remainingMs / 60_000);
  const remainingSec = Math.floor((remainingMs % 60_000) / 1000);

  const filledFields = useMemo(
    () => fields.filter((f) => {
      const v = customer?.[f.key];
      return v !== null && v !== undefined && String(v).trim() !== "";
    }),
    [customer, fields]
  );

  const saveEdit = async () => {
    if (!editing) return;
    try {
      let val: any = editVal.trim() || null;
      if (editing === "electricity_bill_value") {
        val = Number(String(editVal).replace(",", ".")) || null;
      }
      await supabase.from("customers").update({ [editing]: val } as never).eq("id", customer.id);
      setEditing(null);
      haptics.tap();
    } catch (e: any) {
      haptics.error();
      toast({ title: "Erro", description: e?.message || String(e), variant: "destructive" });
    }
  };

  /**
   * Confirmação interna do consultor — apenas marca como confirmado no banco.
   * NÃO dispara nenhuma mensagem no WhatsApp do cliente nem avança o fluxo do bot.
   * O fluxo do WhatsApp só avança quando o próprio cliente confirma (via `askClient`).
   */
  const confirmSelf = async () => {
    setBusy("self");
    try {
      const nowIso = new Date().toISOString();
      const updatePayload: any = {
        [kind === "bill" ? "bill_data_confirmed_at" : "doc_data_confirmed_at"]: nowIso,
        [kind === "bill" ? "bill_data_confirmation_by" : "doc_data_confirmation_by"]: "consultant",
        ocr_review_pending: null,
        ocr_review_decided_at: nowIso,
        ocr_review_decided_by: "consultant",
        // Despausa o bot — se o lead caiu no watchdog antes do OCR, esse é o
        // momento de liberar pra ele voltar ao fluxo.
        bot_paused: false,
        bot_paused_reason: null,
        bot_paused_at: null,
        bot_paused_until: null,
      };
      await supabase.from("customers").update(updatePayload).eq("id", customer.id);

      // Avança o fluxo: simulação (até 20%) + próximo capture step.
      // Erros aqui não revertem a confirmação — log e segue.
      try {
        await dispatchPostBillConfirm({ customer, kind, continueFlowOnNextCapture: true });
      } catch (dispatchErr: any) {
        console.warn("[ocr-review] dispatchPostBillConfirm falhou:", dispatchErr?.message);
      }

      haptics.success();
      toast({ title: "✓ Dados confirmados", description: "Bot vai seguir o fluxo automaticamente", duration: 2200 });
      onDecided?.();
    } catch (e: any) {
      haptics.error();
      toast({ title: "Erro", description: e?.message || String(e), variant: "destructive" });
    } finally {
      setBusy("");
    }
  };

  /** Consultor manda os dados pro cliente confirmar via WhatsApp. */
  const askClient = async () => {
    setBusy("client");
    try {
      const updatePayload: any = {
        [kind === "bill" ? "bill_data_confirmation_by" : "doc_data_confirmation_by"]: "awaiting_client",
        ocr_review_pending: null,
        ocr_review_decided_at: new Date().toISOString(),
        ocr_review_decided_by: "awaiting_client",
        // Volta o passo pro fluxo legado mandar a confirmação ao cliente.
        conversation_step: kind === "bill" ? "confirmando_dados_conta" : "confirmando_dados_doc",
      };
      await supabase.from("customers").update(updatePayload).eq("id", customer.id);

      // Dispara o passo de confirmação pelo bot — ele manda a mensagem
      // formatada com SIM/NÃO/EDITAR pro cliente.
      try {
        await supabase.functions.invoke("manual-step-send", {
          body: {
            consultantId: customer.consultant_id,
            customerId: customer.id,
            stepKey: kind === "bill" ? "confirmando_dados_conta" : "confirmando_dados_doc",
            part: "all",
            continueFlow: false,
            skipNameGuard: true,
          },
        });
      } catch (sendErr: any) {
        console.warn("[ocr-review] dispatch failed:", sendErr?.message);
      }

      haptics.click();
      toast({ title: "📩 Enviado ao cliente", description: "Aguardando confirmação no WhatsApp", duration: 2200 });
      onDecided?.();
    } catch (e: any) {
      haptics.error();
      toast({ title: "Erro", description: e?.message || String(e), variant: "destructive" });
    } finally {
      setBusy("");
    }
  };

  if (!customer || customer.ocr_review_pending !== kind) return null;

  const Icon = kind === "bill" ? FileText : IdCard;
  const title = kind === "bill" ? "Conta de luz lida — confirme antes de seguir" : "Documento lido — confirme antes de seguir";
  const photoLabel = kind === "bill" ? "📄 Conta de luz enviada" : "🪪 Documento (frente)";

  return (
    <div className="rounded-2xl border-2 border-warning/70 bg-gradient-to-br from-warning/10 via-card to-card shadow-[0_0_40px_-8px_hsl(45_95%_55%/0.4)] overflow-hidden animate-in fade-in slide-in-from-top-2 zoom-in-95">
      {/* Header com countdown */}
      <div className="px-4 py-2.5 border-b border-warning/30 bg-gradient-to-r from-warning/10 to-transparent flex items-center gap-2">
        <div className="w-9 h-9 rounded-lg bg-warning/20 border border-warning/40 flex items-center justify-center shrink-0">
          <Icon className="w-4 h-4 text-warning" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-bold text-foreground">{title}</p>
          <p className="text-[10px] text-muted-foreground">{customer.name || customer.phone_whatsapp || "Cliente interessado"}</p>
        </div>
        <Badge variant="outline" className="border-warning/50 text-warning gap-1 text-[10px] tabular-nums">
          <Clock className="w-3 h-3" />
          {String(remainingMin).padStart(2, "0")}:{String(remainingSec).padStart(2, "0")}
        </Badge>
      </div>

      {/* Countdown bar */}
      <div className="h-1 bg-secondary overflow-hidden">
        <div
          className={`h-full transition-[width] ease-linear ${remainingMs < 60_000 ? "bg-destructive/100" : "bg-warning"}`}
          style={{ width: `${timeoutPct}%`, transitionDuration: "1000ms" }}
        />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-[260px_1fr] gap-3 p-3">
        {/* Foto à esquerda (em desktop), em cima (em mobile) */}
        <div className="space-y-1.5">
          <p className="text-[10px] uppercase tracking-wide text-muted-foreground font-bold">{photoLabel}</p>
          {photoUrl ? (
            <a href={photoUrl} target="_blank" rel="noreferrer" className="block">
              <img
                src={photoUrl}
                alt={photoLabel}
                className="w-full h-auto max-h-64 md:max-h-80 rounded-lg border border-border/60 object-contain bg-secondary/30 hover:opacity-90 transition cursor-zoom-in"
                onError={(e) => { (e.target as HTMLImageElement).style.opacity = "0.3"; }}
              />
            </a>
          ) : (
            <div className="w-full h-40 rounded-lg border border-border/60 bg-secondary/30 flex flex-col items-center justify-center text-muted-foreground gap-1">
              <AlertCircle className="w-6 h-6" />
              <span className="text-[10px]">Foto não disponível</span>
            </div>
          )}
          <p className="text-[9px] text-muted-foreground italic">Toque na foto pra ampliar</p>
        </div>

        {/* Dados extraídos à direita */}
        <div className="space-y-1.5 min-w-0">
          <p className="text-[10px] uppercase tracking-wide text-muted-foreground font-bold">
            ✨ Dados extraídos pela IA · {filledFields.length}/{fields.length}
          </p>
          <div className="rounded-lg border border-border/60 bg-card/60 divide-y divide-border/40">
            {fields.map((f) => {
              const v = customer?.[f.key];
              const filled = v !== null && v !== undefined && String(v).trim() !== "";
              const isEditing = editing === f.key;
              return (
                <div key={f.key} className="flex items-center gap-2 px-2 py-1.5 text-[11px]">
                  <Label className="text-muted-foreground w-20 text-[10px] shrink-0">{f.label}</Label>
                  {isEditing ? (
                    <>
                      <Input
                        value={editVal}
                        onChange={(e) => setEditVal(e.target.value)}
                        onKeyDown={(e) => { if (e.key === "Enter") void saveEdit(); if (e.key === "Escape") setEditing(null); }}
                        autoFocus
                        className="h-6 text-[11px] px-1.5 flex-1"
                      />
                      <button onClick={() => void saveEdit()} className="text-primary shrink-0 p-0.5"><Check className="w-3 h-3" /></button>
                      <button onClick={() => setEditing(null)} className="text-muted-foreground shrink-0 p-0.5"><X className="w-3 h-3" /></button>
                    </>
                  ) : (
                    <>
                      <span className={`flex-1 min-w-0 truncate ${filled ? "font-semibold text-foreground" : "italic text-muted-foreground"}`}>
                        {filled ? String(v) : "— vazio —"}
                      </span>
                      <button
                        onClick={() => { setEditing(f.key); setEditVal(filled ? String(v) : ""); }}
                        className="opacity-50 hover:opacity-100 shrink-0 p-0.5"
                        title="Editar"
                      >
                        <Edit2 className="w-2.5 h-2.5" />
                      </button>
                    </>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Footer: dois botões grandes lado a lado */}
      <div className="grid grid-cols-2 gap-2 p-3 pt-0">
        <Button
          size="lg"
          className="h-12 gap-2 font-bold bg-gradient-to-r from-primary to-primary text-white hover:opacity-95 shadow-lg shadow-emerald-500/30"
          onClick={() => void confirmSelf()}
          disabled={busy !== ""}
          title="Eu mesmo confirmo os dados e o bot avança automaticamente"
        >
          {busy === "self" ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
          Eu confirmo
        </Button>
        <Button
          size="lg"
          variant="outline"
          className="h-12 gap-2 font-bold border-2 border-warning/60 hover:bg-warning/10"
          onClick={() => void askClient()}
          disabled={busy !== ""}
          title="Manda os dados no WhatsApp pro cliente confirmar (SIM/NÃO/EDITAR)"
        >
          {busy === "client" ? <Loader2 className="w-4 h-4 animate-spin" /> : <MessageCircle className="w-4 h-4" />}
          Pedir ao cliente
        </Button>
      </div>
    </div>
  );
}
