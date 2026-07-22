import { Card } from "@/components/ui/card";
import { MousePointerClick, MessageCircle, CheckCircle2, ArrowRight, HelpCircle } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

interface Props {
  spendCents: number;
  clicks: number;
  leads: number;          // conversas iniciadas no WhatsApp
  approved: number;       // clientes aprovados (estágio "aprovado")
}

/**
 * Card educativo que responde a pergunta: "Cliente interessado vs Click vs Cliente?"
 * Mostra os 3 estágios com o custo de cada um, usando os números reais do consultor.
 */
export function CostExplainerCard({ spendCents, clicks, leads, approved }: Props) {
  const spend = spendCents / 100;
  const cpc = clicks > 0 ? spend / clicks : 0;
  const cpl = leads > 0 ? spend / leads : 0;
  const cpa = approved > 0 ? spend / approved : 0;

  const Step = ({
    icon: Icon,
    label,
    count,
    cost,
    costLabel,
    explanation,
    accent,
  }: {
    icon: typeof MousePointerClick;
    label: string;
    count: number;
    cost: number;
    costLabel: string;
    explanation: string;
    accent: string;
  }) => (
    <div className="flex-1 min-w-0">
      <div
        className={`relative rounded-2xl border p-4 sm:p-5 h-full transition-all hover:scale-[1.02] ${accent}`}
      >
        <div className="flex items-center justify-between mb-3">
          <div className="p-2 rounded-xl bg-background/60 backdrop-blur">
            <Icon className="w-5 h-5" />
          </div>
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <button className="opacity-60 hover:opacity-100">
                  <HelpCircle className="w-3.5 h-3.5" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="top" className="max-w-[220px] text-xs">
                {explanation}
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>
        <div className="text-[11px] uppercase tracking-wider font-semibold opacity-70">
          {label}
        </div>
        <div className="flex items-baseline gap-2 mt-1">
          <span className="text-3xl ads-num font-bold">{count}</span>
          <span className="text-xs opacity-70">
            {count === 1 ? "pessoa" : "pessoas"}
          </span>
        </div>
        <div className="mt-3 pt-3 border-t border-current/10">
          <div className="text-[10px] uppercase opacity-60">{costLabel}</div>
          <div className="text-lg font-bold font-mono">
            {cost > 0 ? `R$ ${cost.toFixed(2)}` : "—"}
          </div>
        </div>
      </div>
    </div>
  );

  return (
    <Card className="p-5 sm:p-6 bg-gradient-to-br from-primary/8 via-background to-background border-primary/20">
      <div className="mb-5">
        <h3 className="ads-heading font-bold text-base sm:text-lg text-foreground">
          Quanto custa cada cliente?
        </h3>
        <p className="text-xs sm:text-sm text-muted-foreground mt-1">
          Você gastou <strong className="text-foreground">R$ {spend.toFixed(2)}</strong> em
          anúncios. Veja exatamente em que etapa cada real virou resultado:
        </p>
      </div>

      <div className="flex flex-col sm:flex-row items-stretch gap-3 sm:gap-2">
        <Step
          icon={MousePointerClick}
          label="1. Clicou no anúncio"
          count={clicks}
          cost={cpc}
          costLabel="Custo por clique"
          explanation="Pessoa que tocou no seu anúncio no Facebook/Instagram. Ainda não falou com você."
          accent="bg-info/10 border-info/30 text-info dark:text-info"
        />

        <div className="flex sm:flex-col items-center justify-center text-muted-foreground py-1 sm:py-0">
          <ArrowRight className="w-5 h-5 sm:rotate-0 rotate-90" />
        </div>

        <Step
          icon={MessageCircle}
          label="2. Entrou no WhatsApp"
          count={leads}
          cost={cpl}
          costLabel="Custo por conversa"
          explanation="Conversas iniciadas reportadas pela Meta (CTWA). É o denominador certo do CPL operacional em anúncio de WhatsApp."
          accent="bg-primary/15 border-primary/40 text-primary"
        />

        <div className="flex sm:flex-col items-center justify-center text-muted-foreground py-1 sm:py-0">
          <ArrowRight className="w-5 h-5 sm:rotate-0 rotate-90" />
        </div>

        <Step
          icon={CheckCircle2}
          label="3. Virou cliente"
          count={approved}
          cost={cpa}
          costLabel="Custo por CLIENTE (CPA)"
          explanation="Cliente interessado que foi até o fim do funil e chegou no estágio 'Aprovado'. Aqui sim é cliente iGreen."
          accent="bg-primary/15 border-primary/40 text-primary dark:text-primary"
        />
      </div>

      <div className="mt-5 pt-4 border-t border-border/40 text-[11px] sm:text-xs text-muted-foreground leading-relaxed">
        <strong className="text-foreground">Como ler:</strong> a etapa 2 usa{" "}
        <strong className="text-primary">conversas Meta (CTWA)</strong>. Contatos no CRM
        com prova de anúncio aparecem nos cards abaixo. Só viram{" "}
        <strong className="text-primary">cliente</strong> quando chegam em{" "}
        <em>Aprovado</em>. O <strong>custo/conversa</strong> é o CPL operacional; o{" "}
        <strong>CPA</strong>, o custo de cada aprovado.
      </div>
    </Card>
  );
}
