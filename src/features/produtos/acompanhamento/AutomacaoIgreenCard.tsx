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

const GROUPS: { title: string; hint: string; items: { key: Key; label: string; desc: string }[] }[] = [
  {
    title: "Alertas e tarefas",
    hint: "Aparecem no seu painel para você agir. Não envia nada pro cliente.",
    items: [
      { key: "alert_boletos_vencendo", label: "Avisar quando um boleto do cliente estiver perto de vencer", desc: "Aparece um aviso no seu painel para você agir." },
      { key: "alert_devolutivas", label: "Avisar quando um cliente for reprovado ou tiver pendência no cadastro", desc: "Aparece no painel para você resolver." },
      { key: "alert_licencas_expirando", label: "Avisar quando um consultor da sua rede estiver perto de perder a licença", desc: "Ajuda você a reter sua rede." },
      { key: "rotinas_tarefas", label: "Criar tarefas automáticas todo dia (aniversariantes, clientes esfriando, quem sumiu)", desc: "Aparecem na sua lista de tarefas." },
    ],
  },
  {
    title: "Automação no WhatsApp",
    hint: "⚠️ Estas opções mandam mensagem sozinhas para o cliente. Ligue só se quiser que aconteça sem você precisar aprovar cada uma.",
    items: [
      { key: "auto_wa_boleto_vencendo", label: "Enviar o boleto pro cliente antes de vencer, pelo WhatsApp", desc: "O sistema manda a mensagem sozinho, sem você precisar fazer nada." },
      { key: "auto_wa_aniversariante", label: "Parabenizar o cliente no dia do aniversário, pelo WhatsApp", desc: "O sistema envia sozinho no dia." },
      { key: "cross_sell_bot", label: "Oferecer Telefonia e Seguro Auto para clientes que só têm Energia", desc: "Quando o cliente conversar com o bot, ele mesmo sugere os outros produtos." },
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
          Alertas já vêm ligados. As opções que enviam mensagem direto pro cliente ficam desligadas — ligue só as que você quer que rodem no automático.
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
                      checked={!!settings?.[it.key]}
                      disabled={update.isPending}
                      onCheckedChange={(v) => onToggle(it.key, v)}
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
