import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { CADENCE_GROUP_LABEL } from "@/lib/cadenceCalendarMap";
import { Bot, ExternalLink, MessageSquare, Mic } from "lucide-react";

const PASSOS_A = [
  "Pedir o nome",
  "Áudio Sofia + pedir valor da conta",
  "Explicar economia + botões",
  "Clube iGreen + benefícios",
  "Foto da conta de luz",
  "Documento",
  "E-mail",
  "Confirmar telefone",
  "Portal + código do celular",
  "Link da prova de vida (facial)",
];

/** Grupo A — lead quente, só informação e atalhos */
export function AgendamentosGrupoAPanel() {
  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-orange-500/25 bg-orange-500/5 p-4">
        <div className="flex items-center gap-2 mb-2">
          <Bot className="w-5 h-5 text-orange-600" />
          <p className="font-semibold text-sm">{CADENCE_GROUP_LABEL.A}</p>
          <Badge className="text-[10px]">Sempre no chat</Badge>
        </div>
        <p className="text-[12px] text-muted-foreground leading-relaxed">
          Quando alguém manda &quot;oi&quot; no WhatsApp, o <strong className="text-foreground">robô</strong> conduz
          o cadastro. Isso <strong className="text-foreground">não</strong> usa o acompanhamento de quem esfriou.
        </p>
      </div>

      <div className="rounded-xl border border-border/60 p-4 space-y-2">
        <p className="text-xs font-bold">Sequência do robô (10 passos)</p>
        <ol className="text-[11px] text-muted-foreground space-y-1 list-decimal pl-5">
          {PASSOS_A.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ol>
      </div>

      <div className="grid sm:grid-cols-2 gap-2">
        <Button asChild variant="default" className="rounded-xl text-xs gap-2 h-auto py-3 flex-col items-start">
          <Link to="/admin?tab=voz&sub=textos&cadenceGroup=A" className="flex flex-col items-start gap-1 w-full">
            <span className="flex items-center gap-1.5 font-semibold">
              <MessageSquare className="w-3.5 h-3.5" /> Textos e mensagens
            </span>
            <span className="text-[10px] opacity-80 font-normal">Textos automáticos → Leads novos</span>
          </Link>
        </Button>
        <Button asChild variant="outline" className="rounded-xl text-xs gap-2 h-auto py-3 flex-col items-start">
          <Link to="/admin?tab=voz&sub=audio" className="flex flex-col items-start gap-1 w-full">
            <span className="flex items-center gap-1.5 font-semibold">
              <Mic className="w-3.5 h-3.5" /> Áudios da Sofia
            </span>
            <span className="text-[10px] opacity-80 font-normal">Estúdio de voz</span>
          </Link>
        </Button>
        <Button asChild variant="outline" className="rounded-xl text-xs gap-2">
          <Link to="/admin?tab=whatsapp">
            <MessageSquare className="w-3.5 h-3.5" /> Abrir WhatsApp
          </Link>
        </Button>
        <Button asChild variant="ghost" className="rounded-xl text-xs gap-2">
          <Link to="/admin/fluxos">
            Fluxo do bot <ExternalLink className="w-3 h-3" />
          </Link>
        </Button>
      </div>

      <p className="text-[11px] text-muted-foreground border-t pt-3">
        <strong className="text-foreground">Assumir</strong> no chat pausa o robô para você atender na mão.
        Cliente da carteira iGreen nunca entra neste fluxo de lead novo.
      </p>
    </div>
  );
}
