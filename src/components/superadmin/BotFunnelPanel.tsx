import { useBotFunnel } from "@/hooks/useBotFunnel";
import { Card } from "@/components/ui/card";
import { Loader2, TrendingDown, BarChart3 } from "lucide-react";
import { useState } from "react";

const STEP_LABELS: Record<string, string> = {
  welcome: "Boas-vindas",
  menu_inicial: "Menu inicial",
  pos_video: "Pós-vídeo",
  aguardando_humano: "Aguardando humano",
  aguardando_conta: "Aguardando conta de luz",
  processando_ocr_conta: "Processando OCR conta",
  confirmando_dados_conta: "Confirmando dados da conta",
  ask_tipo_documento: "Escolhendo tipo de documento",
  aguardando_doc_frente: "Aguardando frente do documento",
  aguardando_doc_verso: "Aguardando verso do documento",
  confirmando_dados_doc: "Confirmando dados do documento",
  ask_name: "Pedindo nome",
  ask_cpf: "Pedindo CPF",
  ask_rg: "Pedindo RG",
  ask_birth_date: "Pedindo nascimento",
  ask_phone_confirm: "Confirmando telefone",
  ask_phone: "Pedindo telefone",
  ask_email: "Pedindo email",
  ask_cep: "Pedindo CEP",
  ask_finalizar: "Aguardando finalização",
  finalizando: "Finalizando",
  portal_submitting: "Enviando ao portal",
  aguardando_otp: "Aguardando OTP",
  validando_otp: "Validando OTP",
  aguardando_assinatura: "Aguardando assinatura",
  complete: "Cadastro completo",
};

export function BotFunnelPanel() {
  const [days, setDays] = useState(7);
  const { data: funnel, isLoading } = useBotFunnel(days);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-12">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  const max = Math.max(...(funnel || []).map((s) => s.count), 1);

  return (
    <Card className="overflow-hidden">
      <div className="border-b border-border bg-muted/30 px-4 py-3 flex items-center gap-2">
        <BarChart3 className="h-5 w-5 text-primary" />
        <h3 className="font-semibold">Funil do assistente</h3>
        <select
          value={days}
          onChange={(e) => setDays(Number(e.target.value))}
          className="ml-auto bg-background border border-border rounded-md text-sm px-2 py-1"
        >
          <option value={1}>Últimas 24h</option>
          <option value={7}>Últimos 7 dias</option>
          <option value={30}>Últimos 30 dias</option>
        </select>
      </div>

      {!funnel || funnel.length === 0 ? (
        <div className="p-8 text-center">
          <TrendingDown className="mx-auto mb-3 h-12 w-12 text-muted-foreground" />
          <p className="text-muted-foreground">
            Sem dados de transição registrados nesse período.
            <br />
            <span className="text-xs">
              As métricas começam a popular após interações no bot.
            </span>
          </p>
        </div>
      ) : (
        <div className="p-4 space-y-2">
          {funnel.map((s) => {
            const label = STEP_LABELS[s.step] || s.step;
            const widthPct = (s.count / max) * 100;
            return (
              <div key={s.step} className="space-y-1">
                <div className="flex items-baseline justify-between text-sm">
                  <span className="font-medium truncate">{label}</span>
                  <span className="text-muted-foreground tabular-nums">
                    {s.count.toLocaleString("pt-BR")}{" "}
                    <span className="text-xs">({s.percentage}%)</span>
                  </span>
                </div>
                <div className="h-2 bg-muted rounded-full overflow-hidden">
                  <div
                    className="h-full bg-primary/70 transition-all"
                    style={{ width: `${widthPct}%` }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
}
