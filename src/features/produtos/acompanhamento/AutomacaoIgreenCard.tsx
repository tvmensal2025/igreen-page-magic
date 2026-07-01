import { Loader2 } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import {
  useAutomationSettings,
  useUpdateAutomationSetting,
  type AutomationSettings,
} from "./automationSettings";

type Key = keyof Omit<AutomationSettings, "consultant_id">;

const GROUPS: { title: string; hint: string; locked?: boolean; items: { key: Key; label: string; desc: string }[] }[] = [
  {
    title: "Captura de dados (sempre ativo)",
    hint: "O sync do iGreen busca e salva estes dados a cada sincronização — não dá pra desligar.",
    locked: true,
    items: [
      { key: "capture_boletos", label: "Boletos dos clientes", desc: "Valores, vencimento, status e PDF." },
      { key: "capture_devolutivas", label: "Devolutivas detalhadas", desc: "Categoria, motivo, se é impeditiva." },
      { key: "capture_telecom", label: "Carteira Telecom", desc: "Clientes de telefonia." },
      { key: "capture_seguros", label: "Carteira Seguros", desc: "Clientes de seguro veicular." },
      { key: "capture_cashback", label: "Cashback", desc: "Saldo e ranking de indicações." },
    ],
  },
  {
    title: "Alertas e tarefas",
    hint: "Gera itens acionáveis no seu painel (não envia nada ao cliente).",
    items: [
      { key: "alert_boletos_vencendo", label: "Alerta de boleto vencendo", desc: "Requer captura de boletos." },
      { key: "alert_devolutivas", label: "Alerta de devolutivas", desc: "Requer captura de devolutivas." },
      { key: "alert_licencas_expirando", label: "Alerta de licenças expirando", desc: "Retenção da sua rede." },
      { key: "rotinas_tarefas", label: "Rotinas viram tarefas", desc: "Aniversariantes, esfriando, reengajamento." },
    ],
  },
  {
    title: "Automação no WhatsApp (proativo)",
    hint: "⚠️ Envia mensagens automáticas aos clientes. Ative com cuidado.",
    items: [
      { key: "auto_wa_boleto_vencendo", label: "Lembrete de boleto por WhatsApp", desc: "Envia o boleto ao cliente antes de vencer." },
      { key: "auto_wa_aniversariante", label: "Mensagem de aniversário", desc: "Parabeniza o cliente no dia." },
      { key: "cross_sell_bot", label: "Cross-sell no bot", desc: "Oferece Telecom/Seguros a quem só tem energia." },
    ],
  },
];

export function AutomacaoIgreenCard({ consultantId }: { consultantId?: string }) {
  const { toast } = useToast();
  const { data: settings, isLoading } = useAutomationSettings(consultantId);
  const update = useUpdateAutomationSetting(consultantId);

  const onToggle = (key: Key, value: boolean) => {
    update.mutate(
      { [key]: value } as Partial<AutomationSettings>,
      {
        onSuccess: () => toast({ title: value ? "Ativado" : "Desativado", description: "Preferência salva." }),
        onError: (e) => toast({ title: "Erro ao salvar", description: e instanceof Error ? e.message : "", variant: "destructive" }),
      },
    );
  };

  return (
    <div className="rounded-2xl border bg-card p-4 space-y-4">
      <div>
        <h3 className="font-semibold text-sm">Automações iGreen</h3>
        <p className="text-xs text-muted-foreground mt-1">
          <strong>Captura de dados é obrigatória e sempre salva</strong> (boletos, devolutivas, telecom, seguros, cashback). Alertas já vêm ligados. Automações que enviam mensagem ao cliente permanecem desligadas — ative com cuidado.
        </p>
      </div>

      {isLoading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Carregando…
        </div>
      ) : (
        <div className="space-y-5">
          {GROUPS.map((g) => (
            <div key={g.title} className="space-y-2">
              <div>
                <p className="text-xs font-semibold text-foreground">{g.title}</p>
                <p className="text-[11px] text-muted-foreground">{g.hint}</p>
              </div>
              <div className="space-y-2">
                {g.items.map((it) => (
                  <div key={it.key} className="flex items-center justify-between gap-3 rounded-lg border bg-muted/20 p-2.5">
                    <div className="min-w-0">
                      <Label htmlFor={it.key} className="text-sm">{it.label}</Label>
                      <p className="text-[11px] text-muted-foreground">{it.desc}</p>
                    </div>
                    <Switch
                      id={it.key}
                      checked={g.locked ? true : !!settings?.[it.key]}
                      disabled={g.locked || update.isPending}
                      onCheckedChange={(v) => { if (!g.locked) onToggle(it.key, v); }}
                      title={g.locked ? "Captura obrigatória — sempre salvando" : undefined}
                    />
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
