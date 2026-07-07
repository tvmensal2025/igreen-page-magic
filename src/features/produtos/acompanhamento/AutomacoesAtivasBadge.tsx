// Badge/pílula visível que mostra quais automações proativas do WhatsApp
// estão ligadas para o consultor. Clicar abre um popover com os mesmos
// toggles do card grande — pra desligar sem precisar sair da tela.
import { Zap } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import {
  useAutomationSettings,
  useUpdateAutomationSetting,
  type AutomationSettings,
} from "./automationSettings";

type ProKey = "auto_wa_boleto_vencendo" | "auto_wa_aniversariante" | "cross_sell_bot";

const PROACTIVE: { key: ProKey; short: string; label: string; desc: string }[] = [
  {
    key: "auto_wa_boleto_vencendo",
    short: "Boleto no WhatsApp",
    label: "Enviar o boleto pro cliente antes de vencer, pelo WhatsApp",
    desc: "O sistema manda a mensagem sozinho, sem você precisar fazer nada.",
  },
  {
    key: "auto_wa_aniversariante",
    short: "Aniversário",
    label: "Parabenizar o cliente no dia do aniversário, pelo WhatsApp",
    desc: "O sistema envia sozinho no dia.",
  },
  {
    key: "cross_sell_bot",
    short: "Cross-sell no bot",
    label: "Oferecer Telefonia e Seguro Auto para clientes que só têm Energia",
    desc: "Quando o cliente conversar com o bot, ele mesmo sugere os outros produtos.",
  },
];

interface Props {
  consultantId?: string;
  variant?: "chip" | "chips" | "dot";
  className?: string;
}

export function AutomacoesAtivasBadge({ consultantId, variant = "chip", className = "" }: Props) {
  const { toast } = useToast();
  const { data: settings, isLoading } = useAutomationSettings(consultantId);
  const update = useUpdateAutomationSetting(consultantId);

  if (!consultantId || isLoading || !settings) return null;

  const activeItems = PROACTIVE.filter((p) => !!settings[p.key]);
  if (activeItems.length === 0) return null;

  const onToggle = (key: ProKey, value: boolean) => {
    update.mutate(
      { [key]: value } as Partial<AutomationSettings>,
      {
        onSuccess: () => toast({ title: value ? "Ativado" : "Desativado", description: "Preferência salva." }),
        onError: (e) => toast({ title: "Erro ao salvar", description: e instanceof Error ? e.message : "", variant: "destructive" }),
      },
    );
  };

  const trigger = (() => {
    if (variant === "dot") {
      return (
        <button
          type="button"
          aria-label={`${activeItems.length} automações ligadas`}
          title={`${activeItems.length} automação(ões) ligada(s) — clique pra ajustar`}
          className={`inline-flex h-2.5 w-2.5 rounded-full bg-amber-500 ring-2 ring-amber-500/25 hover:ring-amber-500/50 transition ${className}`}
        />
      );
    }
    if (variant === "chips") {
      return (
        <button
          type="button"
          className={`inline-flex items-center gap-1 flex-wrap rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-[11px] font-medium text-amber-700 dark:text-amber-400 hover:bg-amber-500/15 transition ${className}`}
        >
          <Zap className="h-3 w-3" />
          {activeItems.map((it, i) => (
            <span key={it.key}>
              {it.short}{i < activeItems.length - 1 ? " ·" : ""}
            </span>
          ))}
        </button>
      );
    }
    // chip
    return (
      <button
        type="button"
        className={`inline-flex items-center gap-1.5 rounded-full border border-amber-500/30 bg-amber-500/10 px-2.5 py-1 text-[11px] font-semibold text-amber-700 dark:text-amber-400 hover:bg-amber-500/15 transition ${className}`}
        title="Automações ligadas — clique pra ajustar"
      >
        <Zap className="h-3.5 w-3.5" />
        {activeItems.length} automação{activeItems.length > 1 ? "es" : ""} ligada{activeItems.length > 1 ? "s" : ""}
      </button>
    );
  })();

  return (
    <Popover>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-3">
        <p className="text-xs font-semibold text-foreground">Automações ligadas</p>
        <p className="text-[11px] text-muted-foreground mb-3">
          Estas opções mandam mensagem sozinhas pro cliente. Desligue aqui mesmo se não quiser.
        </p>
        <div className="space-y-2">
          {PROACTIVE.map((it) => (
            <div key={it.key} className="flex items-start justify-between gap-3 rounded-lg border bg-muted/20 p-2">
              <div className="min-w-0">
                <Label htmlFor={`pop-${it.key}`} className="text-[12px] leading-tight">{it.label}</Label>
                <p className="text-[10px] text-muted-foreground mt-0.5">{it.desc}</p>
              </div>
              <Switch
                id={`pop-${it.key}`}
                checked={!!settings[it.key]}
                disabled={update.isPending}
                onCheckedChange={(v) => onToggle(it.key, v)}
              />
            </div>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}
