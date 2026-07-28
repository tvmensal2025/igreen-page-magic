/**
 * Modal do botão ! na pizza — explica cada msg do acompanhamento A/B/C
 * (texto real do Multicanal) + preços SMS/ligação.
 */
import { useMemo, useState } from "react";
import { CircleAlert, MessageSquare, Phone, Smartphone } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { STAGE_CHANNEL, STAGE_TO_CADENCE_KEY } from "@/lib/cadencePreview";
import { getTemplate } from "@/lib/multichannelCadenceTexts";
import {
  CADENCE_BILLING_SUMMARY,
  formatBrl,
  PLATFORM_SMS_PRICE,
  PLATFORM_VOICE_BLOCK_PRICE,
  PLATFORM_VOICE_BLOCK_SEC,
} from "@/lib/voiceCallCost";
import { cn } from "@/lib/utils";

type ChannelFilter = "sms" | "voice" | "whatsapp";

type MsgCard = {
  stage: string;
  group: "A" | "B" | "C";
  title: string;
  timing: string;
  body: string;
  channel: ChannelFilter;
};

const STAGE_ORDER: Array<{ stage: string; group: "A" | "B" | "C" }> = [
  { stage: "A_NUDGE", group: "A" },
  { stage: "A_SMS", group: "A" },
  { stage: "A_CALL", group: "A" },
  { stage: "A_CALL_RETRY", group: "A" },
  { stage: "COLD_1", group: "B" },
  { stage: "SMS_1", group: "B" },
  { stage: "CALL_1", group: "B" },
  { stage: "COLD_2", group: "B" },
  { stage: "SMS_TEMA_2", group: "B" },
  { stage: "CALL_2", group: "B" },
  { stage: "SMS_2", group: "B" },
  { stage: "COLD_3", group: "B" },
  { stage: "SMS_TEMA_7", group: "B" },
  { stage: "CALL_3", group: "B" },
  { stage: "COLD_4", group: "B" },
  { stage: "RECALL_60D", group: "C" },
  { stage: "RECALL_60D_SMS", group: "C" },
  { stage: "RECALL_60D_CALL", group: "C" },
  { stage: "RECALL_90D", group: "C" },
  { stage: "RECALL_90D_SMS", group: "C" },
  { stage: "RECALL_90D_CALL", group: "C" },
  { stage: "RECALL_5M", group: "C" },
  { stage: "RECALL_5M_SMS", group: "C" },
  { stage: "RECALL_5M_CALL", group: "C" },
  { stage: "RECALL_8M", group: "C" },
  { stage: "RECALL_8M_SMS", group: "C" },
  { stage: "RECALL_8M_CALL", group: "C" },
  { stage: "RECALL_12M", group: "C" },
  { stage: "RECALL_12M_SMS", group: "C" },
  { stage: "RECALL_12M_CALL", group: "C" },
  { stage: "RECALL_YEARLY", group: "C" },
  { stage: "RECALL_YEARLY_SMS", group: "C" },
  { stage: "RECALL_YEARLY_CALL", group: "C" },
];

function previewBody(raw: string | undefined, channel: ChannelFilter): string {
  const t = String(raw || "").trim();
  if (!t) return "Texto ainda não configurado nos textos automáticos.";
  if (/^\{\{\s*tema_sms\s*\}\}$/i.test(t) || t.includes("{{tema_sms}}")) {
    return "SMS do tema do dia (o motor escolhe o tema automaticamente).";
  }
  // Prévia sem dados reais — deixa placeholders legíveis.
  return t
    .replace(/\{\{\s*nome\s*\}\}/gi, "[nome]")
    .replace(/\{\{\s*consultor\s*\}\}/gi, "[consultor]")
    .replace(/\{\{\s*assistente\s*\}\}/gi, "[assistente]")
    .replace(/\{\{\s*consultor_phone\s*\}\}/gi, "[whatsapp]")
    .replace(/\{\{\s*tema_sms\s*\}\}/gi, "[tema do dia]")
    .trim();
}

function buildCards(filter: ChannelFilter): MsgCard[] {
  const out: MsgCard[] = [];
  for (const row of STAGE_ORDER) {
    const ch = STAGE_CHANNEL[row.stage];
    if (ch !== filter) continue;
    const key = STAGE_TO_CADENCE_KEY[row.stage];
    const tpl = key ? getTemplate(key) : undefined;
    out.push({
      stage: row.stage,
      group: row.group,
      title: tpl?.title || row.stage,
      timing: tpl?.timing || "",
      body: previewBody(tpl?.body, filter),
      channel: filter,
    });
  }
  return out;
}

function PriceFooter({ channel }: { channel: ChannelFilter }) {
  const s = CADENCE_BILLING_SUMMARY;
  if (channel === "sms") {
    return (
      <p className="text-xs text-muted-foreground leading-relaxed">
        Preço: {formatBrl(PLATFORM_SMS_PRICE)} por SMS enviado com sucesso.
        Máx. no ciclo silencioso: A {s.groups.A.sms} · B {s.groups.B.sms} · C {s.groups.C.sms}
        {" "}(= {s.maxSms} · até {formatBrl(s.maxSmsCost)}).
        Se o lead responder no WhatsApp, paramos o SMS.
      </p>
    );
  }
  if (channel === "voice") {
    return (
      <p className="text-xs text-muted-foreground leading-relaxed">
        Preço iGreen Fone: {formatBrl(PLATFORM_VOICE_BLOCK_PRICE)} a cada {PLATFORM_VOICE_BLOCK_SEC}s
        {" "}só se atender (31s = {formatBrl(0.2)}; 61s = {formatBrl(0.3)}). Não atendeu = {formatBrl(0)}.
        Máx. tentativas: A {s.groups.A.calls} · B {s.groups.B.calls} · C {s.groups.C.calls}.
      </p>
    );
  }
  return (
    <p className="text-xs text-muted-foreground leading-relaxed">
      WhatsApp e chatbot: sem custo por mensagem. Você começa com {formatBrl(1)} de crédito para SMS/ligação.
      Para adicionar mais, fale com o administrador. SMS e ligação usam a mesma carteira dos anúncios.
    </p>
  );
}

function MsgList({ channel }: { channel: ChannelFilter }) {
  const cards = useMemo(() => buildCards(channel), [channel]);
  let lastGroup: string | null = null;
  return (
    <div className="space-y-3 pr-2">
      <PriceFooter channel={channel} />
      {cards.map((c) => {
        const showGroup = c.group !== lastGroup;
        lastGroup = c.group;
        return (
          <div key={c.stage} className="space-y-1.5">
            {showGroup && (
              <p className="text-[11px] font-semibold uppercase tracking-wide text-primary pt-1">
                Grupo {c.group}
              </p>
            )}
            <div className="rounded-lg border bg-muted/20 p-3 space-y-1.5">
              <div className="flex flex-wrap items-center gap-1.5">
                <p className="text-sm font-semibold text-foreground">{c.title}</p>
                {channel === "sms" && (
                  <Badge variant="secondary" className="text-[10px]">{formatBrl(PLATFORM_SMS_PRICE)}</Badge>
                )}
                {channel === "voice" && (
                  <Badge variant="secondary" className="text-[10px]">
                    {formatBrl(PLATFORM_VOICE_BLOCK_PRICE)}/{PLATFORM_VOICE_BLOCK_SEC}s
                  </Badge>
                )}
                {channel === "whatsapp" && (
                  <Badge variant="outline" className="text-[10px]">Grátis</Badge>
                )}
              </div>
              {c.timing ? (
                <p className="text-[11px] text-muted-foreground">{c.timing}</p>
              ) : null}
              <p className="text-xs text-foreground/90 whitespace-pre-wrap leading-relaxed">{c.body}</p>
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function CadenceCostHelpModal({
  className,
  triggerClassName,
}: {
  className?: string;
  triggerClassName?: string;
}) {
  const [open, setOpen] = useState(false);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          type="button"
          size="sm"
          variant="outline"
          className={cn("h-8 w-8 p-0 shrink-0", triggerClassName)}
          title="O que está sendo enviado (SMS, ligação e WhatsApp)"
          aria-label="Explicar mensagens do ciclo A B C"
        >
          <CircleAlert className="w-4 h-4 text-amber-600" />
        </Button>
      </DialogTrigger>
      <DialogContent className={cn("max-w-lg sm:max-w-xl max-h-[85vh] flex flex-col gap-3", className)}>
        <DialogHeader>
          <DialogTitle>O que o acompanhamento envia</DialogTitle>
          <DialogDescription>
            Cada mensagem do ciclo A · B · C. SMS e ligação só disparam se o lead ficar em silêncio.
          </DialogDescription>
        </DialogHeader>
        <Tabs defaultValue="sms" className="flex-1 min-h-0 flex flex-col">
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="sms" className="gap-1 text-xs">
              <Smartphone className="w-3.5 h-3.5" /> SMS
            </TabsTrigger>
            <TabsTrigger value="voice" className="gap-1 text-xs">
              <Phone className="w-3.5 h-3.5" /> Ligação
            </TabsTrigger>
            <TabsTrigger value="whatsapp" className="gap-1 text-xs">
              <MessageSquare className="w-3.5 h-3.5" /> WhatsApp
            </TabsTrigger>
          </TabsList>
          <ScrollArea className="mt-3 h-[min(55vh,420px)] pr-1">
            <TabsContent value="sms" className="mt-0">
              <MsgList channel="sms" />
            </TabsContent>
            <TabsContent value="voice" className="mt-0">
              <MsgList channel="voice" />
            </TabsContent>
            <TabsContent value="whatsapp" className="mt-0">
              <MsgList channel="whatsapp" />
            </TabsContent>
          </ScrollArea>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
