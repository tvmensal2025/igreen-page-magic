import { useEffect, useState } from "react";
import {
  AlertTriangle,
  ArrowLeft,
  Cake,
  Gift,
  Loader2,
  MessageCircle,
  PartyPopper,
  Save,
  Send,
  Settings2,
  Shuffle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import {
  useAutomationSettings,
  useUpdateAutomationSetting,
} from "@/features/produtos/acompanhamento/automationSettings";
import {
  BIRTHDAY_MESSAGE_TEMPLATES,
  fillBirthdayMessage,
  firstNameFrom,
  getPreferredBirthdayTemplate,
  isValidWhatsAppPhone,
  markRetentionWhatsAppOpenedToday,
  pickRandomBirthdayMessage,
  retentionPhoneKey,
  setPreferredBirthdayTemplate,
  wasRetentionWhatsAppOpenedToday,
} from "@/lib/birthdayMessages";
import { sendWhatsAppMessage } from "@/services/messageSender";

/** Envia texto pela instância conectada (Whapi/Evolution) — não abre wa.me. */
async function sendRetentionViaInstance(opts: {
  instanceName?: string | null;
  isWhapi?: boolean;
  phone: string;
  text: string;
  customerId?: string;
  conversationStep: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const { instanceName, isWhapi, phone, text, customerId, conversationStep } = opts;
  if (!isValidWhatsAppPhone(phone)) {
    return { ok: false, error: "Sem WhatsApp cadastrado" };
  }
  if (!isWhapi && !instanceName) {
    return { ok: false, error: "WhatsApp desconectado — reconecte na aba Conversas" };
  }
  const result = await sendWhatsAppMessage({
    instanceName: instanceName || (isWhapi ? "whapi-superadmin" : ""),
    phone,
    mediaCategory: "text",
    text,
    isWhapi: !!isWhapi,
    customerId: customerId || null,
    conversationStep,
    intent: "reply",
  });
  if (result.status === "failed") {
    return { ok: false, error: result.error || "Falha ao enviar" };
  }
  return { ok: true };
}

/** Templates locais de reativação — usam {{nome}} igual aniversário. */
const REACTIVATION_TEMPLATES: readonly string[] = [
  `Oi *{{nome}}*! ⚡

Tudo bem? Faz um tempinho que a gente não conversa.

Passei aqui pela *iGreen* pra saber se posso te ajudar com alguma coisa. 🌱💚`,

  `Oi *{{nome}}*, aqui é da *iGreen*! ⚡

Vi que seu cadastro ficou pendente — quer que eu te ajude a finalizar?

Leva *2 minutinhos*. 💚`,

  `*{{nome}}*, tudo certo? ⚡

Notei que ficamos um bom tempo sem falar.

Se quiser, posso te mandar de novo como funciona a *economia na conta de luz* com a *iGreen*. 💡💚`,

  `Oi *{{nome}}*! ⚡

Já já a gente fecha as vagas do mês na *iGreen*.

Se quiser garantir o *desconto* na sua conta de luz, me chama aqui. 👋💚`,

  `*{{nome}}*, tudo joia? ⚡

Só passando pra lembrar que sua economia com a *iGreen* ainda tá te esperando.

Bora conversar? 🌿💚`,

  `Oi *{{nome}}*, sumida(o)! 😅⚡

Tô aqui pela *iGreen* se precisar de qualquer coisa.

Qualquer dúvida é só chamar. 💚`,
];

function pickRandom(list: readonly string[]): string {
  return list[Math.floor(Math.random() * list.length)];
}

interface Customer {
  id: string;
  name?: string | null;
  phone_whatsapp?: string | null;
  status?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  data_nascimento?: string | null;
}

type CustomerWithMeta = Customer & { _dupCount?: number };

/**
 * Colapsa cadastros com o mesmo WhatsApp (duplicata / 2 casas no mesmo número).
 * Sem telefone válido: mantém cada um (não dá pra deduplicar).
 */
function dedupeByWhatsApp(customers: Customer[]): CustomerWithMeta[] {
  const byPhone = new Map<string, Customer[]>();
  const noPhone: Customer[] = [];

  for (const c of customers) {
    const key = retentionPhoneKey(c.phone_whatsapp);
    if (!key) {
      noPhone.push(c);
      continue;
    }
    const arr = byPhone.get(key) || [];
    arr.push(c);
    byPhone.set(key, arr);
  }

  const pickBest = (group: Customer[]): CustomerWithMeta => {
    const sorted = [...group].sort((a, b) => {
      const an = (a.name || "").trim().length;
      const bn = (b.name || "").trim().length;
      if (bn !== an) return bn - an;
      const at = new Date(a.updated_at || a.created_at || 0).getTime();
      const bt = new Date(b.updated_at || b.created_at || 0).getTime();
      return bt - at;
    });
    return { ...sorted[0], _dupCount: group.length };
  };

  const out: CustomerWithMeta[] = [];
  for (const group of byPhone.values()) out.push(pickBest(group));
  for (const c of noPhone) out.push({ ...c, _dupCount: 1 });
  return out;
}

const daysSince = (iso?: string | null) => {
  if (!iso) return Infinity;
  return Math.floor((Date.now() - new Date(iso).getTime()) / (1000 * 60 * 60 * 24));
};

// data_nascimento: "YYYY-MM-DD" ou "DD/MM/YYYY"
function parseBirth(s?: string | null): { year: number; month: number; day: number } | null {
  if (!s) return null;
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (iso) {
    const year = Number(iso[1]);
    const month = Number(iso[2]);
    const day = Number(iso[3]);
    if (!month || !day || month > 12 || day > 31) return null;
    return { year, month, day };
  }
  const br = /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/.exec(s.trim());
  if (br) {
    const day = Number(br[1]);
    const month = Number(br[2]);
    let year = Number(br[3]);
    if (br[3].length === 2) year = 2000 + year;
    if (!month || !day || month > 12 || day > 31) return null;
    return { year, month, day };
  }
  return null;
}

function ageThisYear(year: number): number {
  return new Date().getFullYear() - year;
}

function previewMessage(text: string): string {
  return text.replace(/\*([^*]+)\*/g, "$1").replace(/\n+/g, " ").trim();
}

/**
 * Editor de pré-visualização — mostra o texto exato que vai pro WhatsApp,
 * deixa editar, sortear outra e envia pela instância conectada ao clicar em Enviar.
 */
function MessagePreviewEditor({
  initialText,
  templates,
  customerName,
  customerId,
  phone,
  consultantId,
  instanceName,
  isWhapi,
  conversationStep,
  onBack,
  onSent,
  accent = "accent",
}: {
  initialText: string;
  templates: readonly string[];
  customerName?: string | null;
  customerId?: string;
  phone: string;
  consultantId?: string;
  instanceName?: string | null;
  isWhapi?: boolean;
  conversationStep: string;
  onBack: () => void;
  onSent: () => void;
  accent?: "accent" | "primary";
}) {
  const { toast } = useToast();
  const [text, setText] = useState(initialText);
  const [sending, setSending] = useState(false);

  useEffect(() => {
    setText(initialText);
  }, [initialText]);

  const shuffle = () => {
    const tpl = pickRandom(templates);
    setText(fillBirthdayMessage(tpl, customerName));
  };

  const send = async () => {
    if (!text.trim()) {
      toast({ title: "Escreva uma mensagem antes de enviar", variant: "destructive" });
      return;
    }
    if (wasRetentionWhatsAppOpenedToday(consultantId, phone)) {
      toast({
        title: "Já enviado hoje para este número",
        description: "Mesmo WhatsApp em outro cadastro — não manda de novo no mesmo dia.",
        variant: "destructive",
      });
      return;
    }
    setSending(true);
    try {
      const result = await sendRetentionViaInstance({
        instanceName,
        isWhapi,
        phone,
        text,
        customerId,
        conversationStep,
      });
      if (result.ok !== true) {
        toast({ title: result.error, variant: "destructive" });
        return;
      }
      markRetentionWhatsAppOpenedToday(consultantId, phone);
      toast({
        title: "Mensagem enviada",
        description: `Enviada para ${customerName || "o cliente"} pelo WhatsApp conectado.`,
      });
      onSent();
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="p-3 space-y-2">
      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={onBack}
          className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition"
        >
          <ArrowLeft className="w-3 h-3" /> Trocar mensagem
        </button>
        <button
          type="button"
          onClick={shuffle}
          className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition"
        >
          <Shuffle className="w-3 h-3" /> Sortear outra
        </button>
      </div>
      <Textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={7}
        className="text-xs leading-relaxed resize-none"
        disabled={sending}
      />
      <div className="flex items-center justify-between">
        <span className="text-[10px] text-muted-foreground">{text.length} caracteres</span>
        <span className="text-[10px] text-muted-foreground">*negrito* funciona no WhatsApp</span>
      </div>
      <Button
        type="button"
        size="sm"
        className={`w-full h-9 gap-1.5 text-xs font-bold ${accent === "accent" ? "bg-accent text-accent-foreground hover:bg-accent/90" : ""}`}
        onClick={() => void send()}
        disabled={sending}
      >
        {sending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
        Enviar pelo WhatsApp conectado
      </Button>
    </div>
  );
}

/** Botão + popover: pré-visualiza e edita antes de enviar. Reusado por aniversário e reativação. */
function MessageButton({
  customer,
  consultantId,
  instanceName,
  isWhapi,
  templates,
  preferredTemplate,
  conversationStep,
  triggerLabel,
  triggerIcon,
  triggerClassName,
  headerIcon,
  headerTitle,
  headerSub,
  accent = "accent",
  sentTick,
  onSentExternal,
}: {
  customer: CustomerWithMeta;
  consultantId?: string;
  instanceName?: string | null;
  isWhapi?: boolean;
  templates: readonly string[];
  preferredTemplate?: string;
  conversationStep: string;
  triggerLabel: string;
  triggerIcon: React.ReactNode;
  triggerClassName: string;
  headerIcon: React.ReactNode;
  headerTitle: string;
  headerSub: string;
  accent?: "accent" | "primary";
  sentTick?: number;
  onSentExternal?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [screen, setScreen] = useState<"list" | "edit">("list");
  const [selectedText, setSelectedText] = useState("");
  const [alreadyToday, setAlreadyToday] = useState(() =>
    wasRetentionWhatsAppOpenedToday(consultantId, customer.phone_whatsapp),
  );
  const hasPhone = isValidWhatsAppPhone(customer.phone_whatsapp);
  const dupCount = customer._dupCount && customer._dupCount > 1 ? customer._dupCount : 0;

  useEffect(() => {
    setAlreadyToday(wasRetentionWhatsAppOpenedToday(consultantId, customer.phone_whatsapp));
  }, [consultantId, customer.phone_whatsapp, sentTick]);

  useEffect(() => {
    if (!open) {
      setScreen("list");
      setSelectedText("");
      setAlreadyToday(wasRetentionWhatsAppOpenedToday(consultantId, customer.phone_whatsapp));
    }
  }, [open, consultantId, customer.phone_whatsapp]);

  if (!hasPhone) {
    return (
      <span className="text-[10px] text-muted-foreground" title="Sem celular cadastrado">
        sem zap
      </span>
    );
  }

  if (alreadyToday) {
    return (
      <span
        className="text-[10px] font-semibold text-muted-foreground px-1.5 py-0.5 rounded-md bg-muted/60"
        title="Mensagem já enviada hoje para este número (inclui outros cadastros com o mesmo zap)"
      >
        já hoje
      </span>
    );
  }

  const openWith = (tpl: string) => {
    setSelectedText(fillBirthdayMessage(tpl, customer.name));
    setScreen("edit");
  };

  const firstName = firstNameFrom(customer.name);
  const accentText = "text-primary";
  const accentBg = "bg-primary/5";
  const orderedTemplates = preferredTemplate
    ? [preferredTemplate, ...templates.filter((t) => t !== preferredTemplate)]
    : [...templates];

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className={triggerClassName}
          title={
            dupCount
              ? `${triggerLabel} · ${dupCount} cadastros no mesmo WhatsApp (envia 1x)`
              : triggerLabel
          }
        >
          {triggerIcon}
          <span className="hidden sm:inline">{triggerLabel}</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[min(100vw-2rem,22rem)] p-0" align="end">
        <div className={`px-3 py-2.5 border-b border-border/50 ${accentBg}`}>
          <p className="text-xs font-bold text-foreground flex items-center gap-1.5">
            {headerIcon}
            {headerTitle} {firstName}
          </p>
          <p className="text-[10px] text-muted-foreground mt-0.5">{headerSub}</p>
          {dupCount > 0 && (
            <p className="text-[10px] text-amber-800 dark:text-amber-300 mt-1 font-medium">
              {dupCount} cadastros com o mesmo WhatsApp — envio único.
            </p>
          )}
        </div>

        <div>
          {screen === "list" ? (
            <div>
              <div className="p-2 border-b border-border/40 space-y-1.5">
                {preferredTemplate && (
                  <Button
                    type="button"
                    size="sm"
                    className="w-full h-8 gap-1.5 text-xs font-bold bg-accent text-accent-foreground hover:bg-accent/90"
                    onClick={() => openWith(preferredTemplate)}
                  >
                    <Gift className="w-3.5 h-3.5" />
                    Usar minha mensagem
                  </Button>
                )}
                <Button
                  type="button"
                  size="sm"
                  variant={preferredTemplate ? "outline" : "default"}
                  className="w-full h-8 gap-1.5 text-xs font-bold"
                  onClick={() => openWith(pickRandom(templates))}
                >
                  <Shuffle className="w-3.5 h-3.5" />
                  Sortear e personalizar
                </Button>
              </div>
              <ul className="max-h-[240px] overflow-y-auto divide-y divide-border/30">
                {orderedTemplates.map((tpl, i) => (
                  <li key={i}>
                    <button
                      type="button"
                      className="w-full text-left px-3 py-2.5 hover:bg-muted/50 transition-colors"
                      onClick={() => openWith(tpl)}
                    >
                      <span className={`text-[10px] font-bold uppercase tracking-wide ${accentText}`}>
                        {preferredTemplate && i === 0 ? "Sua mensagem" : `Mensagem ${i + 1}`} — clique para ver e editar
                      </span>
                      <p className="text-[11px] text-muted-foreground line-clamp-2 mt-0.5">
                        {previewMessage(fillBirthdayMessage(tpl, customer.name))}
                      </p>
                    </button>
                  </li>
                ))}
              </ul>
              <div className="px-3 py-2 border-t border-border/40 bg-muted/20">
                <p className="text-[10px] text-muted-foreground flex items-center gap-1">
                  <MessageCircle className="w-3 h-3" />
                  Envia pela instância conectada. Mesmo número = 1 envio/dia.
                </p>
              </div>
            </div>
          ) : (
            <MessagePreviewEditor
              initialText={selectedText}
              templates={templates}
              customerName={customer.name}
              customerId={customer.id}
              phone={customer.phone_whatsapp || ""}
              consultantId={consultantId}
              instanceName={instanceName}
              isWhapi={isWhapi}
              conversationStep={conversationStep}
              onBack={() => setScreen("list")}
              onSent={() => {
                setAlreadyToday(true);
                setOpen(false);
                onSentExternal?.();
              }}
              accent={accent}
            />
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

/** Nome clicável — envia direto a mensagem preferida/sorteada pela instância conectada. */
function RetentionCustomerName({
  customer,
  consultantId,
  instanceName,
  isWhapi,
  templates,
  preferredTemplate,
  conversationStep,
  sentTick,
  onSent,
}: {
  customer: CustomerWithMeta;
  consultantId?: string;
  instanceName?: string | null;
  isWhapi?: boolean;
  templates: readonly string[];
  preferredTemplate?: string;
  conversationStep: string;
  /** Quando o botão Parabenizar/Mandar oi marca envio, o nome também mostra "já hoje". */
  sentTick?: number;
  onSent?: () => void;
}) {
  const { toast } = useToast();
  const [sending, setSending] = useState(false);
  const [alreadyToday, setAlreadyToday] = useState(() =>
    wasRetentionWhatsAppOpenedToday(consultantId, customer.phone_whatsapp),
  );
  const hasPhone = isValidWhatsAppPhone(customer.phone_whatsapp);

  useEffect(() => {
    setAlreadyToday(wasRetentionWhatsAppOpenedToday(consultantId, customer.phone_whatsapp));
  }, [consultantId, customer.phone_whatsapp, sentTick]);

  const handleClick = async () => {
    if (!hasPhone) {
      toast({ title: "Sem WhatsApp cadastrado", variant: "destructive" });
      return;
    }
    if (alreadyToday || wasRetentionWhatsAppOpenedToday(consultantId, customer.phone_whatsapp)) {
      toast({
        title: "Já enviado hoje para este número",
        description: "Mesmo WhatsApp em outro cadastro — não manda de novo no mesmo dia.",
        variant: "destructive",
      });
      setAlreadyToday(true);
      return;
    }
    const tpl = preferredTemplate || pickRandom(templates);
    const text = fillBirthdayMessage(tpl, customer.name);
    setSending(true);
    try {
      const result = await sendRetentionViaInstance({
        instanceName,
        isWhapi,
        phone: customer.phone_whatsapp || "",
        text,
        customerId: customer.id,
        conversationStep,
      });
      if (result.ok !== true) {
        toast({ title: result.error, variant: "destructive" });
        return;
      }
      markRetentionWhatsAppOpenedToday(consultantId, customer.phone_whatsapp);
      setAlreadyToday(true);
      toast({
        title: "Mensagem enviada",
        description: `Enviada para ${customer.name || "o cliente"} pelo WhatsApp conectado.`,
      });
      onSent?.();
    } finally {
      setSending(false);
    }
  };

  return (
    <button
      type="button"
      onClick={() => void handleClick()}
      disabled={sending || alreadyToday || !hasPhone}
      title={
        alreadyToday
          ? "Já enviado hoje"
          : !hasPhone
            ? "Sem WhatsApp cadastrado"
            : "Clique para enviar pelo WhatsApp conectado"
      }
      className={`min-w-0 w-full text-left group disabled:cursor-default ${
        alreadyToday || !hasPhone
          ? ""
          : "hover:opacity-90 cursor-pointer"
      }`}
    >
      <p
        className={`text-sm font-semibold truncate flex items-center gap-1.5 ${
          alreadyToday || !hasPhone
            ? "text-foreground"
            : "text-primary group-hover:underline underline-offset-2"
        }`}
      >
        {sending && <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" />}
        {customer.name || "Sem nome"}
      </p>
      {(customer._dupCount || 0) > 1 && (
        <p className="text-[10px] text-amber-700 dark:text-amber-300 truncate">
          {customer._dupCount} cadastros · mesmo WhatsApp
        </p>
      )}
    </button>
  );
}

function BirthdayMessageButton({
  customer,
  consultantId,
  instanceName,
  isWhapi,
  preferredTemplate,
  sentTick,
  onSent,
}: {
  customer: CustomerWithMeta;
  consultantId?: string;
  instanceName?: string | null;
  isWhapi?: boolean;
  preferredTemplate?: string;
  sentTick?: number;
  onSent?: () => void;
}) {
  return (
    <MessageButton
      customer={customer}
      consultantId={consultantId}
      instanceName={instanceName}
      isWhapi={isWhapi}
      templates={BIRTHDAY_MESSAGE_TEMPLATES}
      preferredTemplate={preferredTemplate}
      conversationStep="retention_birthday"
      triggerLabel="Parabenizar"
      triggerIcon={<Gift className="w-3 h-3" />}
      triggerClassName="h-7 gap-1 px-2 text-[10px] rounded-lg border-primary/40 text-primary hover:bg-primary/10"
      headerIcon={<Cake className="w-3.5 h-3.5 text-primary" />}
      headerTitle="Parabenizar"
      headerSub="Mensagens prontas — clique pra ver e editar antes de enviar"
      accent="accent"
      sentTick={sentTick}
      onSentExternal={onSent}
    />
  );
}

function ReactivationMessageButton({
  customer,
  consultantId,
  instanceName,
  isWhapi,
  sentTick,
  onSent,
}: {
  customer: CustomerWithMeta;
  consultantId?: string;
  instanceName?: string | null;
  isWhapi?: boolean;
  sentTick?: number;
  onSent?: () => void;
}) {
  return (
    <MessageButton
      customer={customer}
      consultantId={consultantId}
      instanceName={instanceName}
      isWhapi={isWhapi}
      templates={REACTIVATION_TEMPLATES}
      conversationStep="retention_reactivation"
      triggerLabel="Mandar oi"
      triggerIcon={<MessageCircle className="w-3 h-3" />}
      triggerClassName="h-7 gap-1 px-2 text-[10px] rounded-lg border-primary/40 text-primary hover:bg-primary/10"
      headerIcon={<MessageCircle className="w-3.5 h-3.5 text-primary" />}
      headerTitle="Reativar"
      headerSub="Mensagens curtas — clique pra ver e editar antes de enviar"
      accent="primary"
      sentTick={sentTick}
      onSentExternal={onSent}
    />
  );
}

/** Painel: ativar fila de aniversário + ajustar mensagem padrão (bonita e organizada). */
function BirthdaySettingsDialog({
  open,
  onOpenChange,
  consultantId,
  preferredTemplate,
  onPreferredChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  consultantId?: string;
  preferredTemplate: string;
  onPreferredChange: (tpl: string) => void;
}) {
  const { toast } = useToast();
  const { data: settings, isLoading } = useAutomationSettings(consultantId);
  const update = useUpdateAutomationSetting(consultantId);
  const [draft, setDraft] = useState(preferredTemplate);
  const [savingMsg, setSavingMsg] = useState(false);

  useEffect(() => {
    if (open) setDraft(preferredTemplate);
  }, [open, preferredTemplate]);

  const enabled = !!settings?.auto_wa_aniversariante;

  const onToggle = (value: boolean) => {
    if (!consultantId) {
      toast({ title: "Consultor não identificado", variant: "destructive" });
      return;
    }
    update.mutate(
      { auto_wa_aniversariante: value },
      {
        onSuccess: () =>
          toast({
            title: value ? "Fila de aniversário ativada" : "Fila de aniversário desligada",
            description: value
              ? "Cria alerta no painel. Envio real só com liberação na Central."
              : "Nenhum alerta de aniversário será enfileirado.",
          }),
        onError: (e) =>
          toast({
            title: "Erro ao salvar",
            description: e instanceof Error ? e.message : "",
            variant: "destructive",
          }),
      },
    );
  };

  const saveMessage = () => {
    if (!consultantId) return;
    if (!draft.trim()) {
      toast({ title: "Escreva a mensagem antes de salvar", variant: "destructive" });
      return;
    }
    setSavingMsg(true);
    setPreferredBirthdayTemplate(consultantId, draft);
    onPreferredChange(draft);
    setSavingMsg(false);
    toast({ title: "Mensagem salva", description: "Será a primeira opção ao parabenizar." });
  };

  const applyTemplate = (tpl: string) => setDraft(tpl);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg max-h-[90dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Cake className="w-5 h-5 text-primary" />
            Aniversariantes
          </DialogTitle>
          <DialogDescription>
            Ative a fila no painel e deixe sua mensagem de parabéns pronta e formatada.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5">
          {/* Toggle */}
          <div className="rounded-xl border border-border/60 bg-muted/20 p-4 space-y-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 space-y-1">
                <Label htmlFor="auto_wa_aniversariante" className="text-sm font-semibold">
                  Ativar fila de parabéns
                </Label>
                <p className="text-[11px] text-muted-foreground leading-relaxed">
                  Quando ligado, o sync cria um alerta no painel para cada aniversariante do dia.
                  Não manda WhatsApp sozinho — envio real só após liberação na Central.
                </p>
              </div>
              {isLoading ? (
                <Loader2 className="h-4 w-4 animate-spin text-muted-foreground shrink-0 mt-1" />
              ) : (
                <Switch
                  id="auto_wa_aniversariante"
                  checked={enabled}
                  disabled={!consultantId || update.isPending}
                  onCheckedChange={onToggle}
                />
              )}
            </div>
            <div
              className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide ${
                enabled
                  ? "bg-primary/10 text-primary"
                  : "bg-muted text-muted-foreground"
              }`}
            >
              <span className={`h-1.5 w-1.5 rounded-full ${enabled ? "bg-accent" : "bg-muted-foreground/50"}`} />
              {enabled ? "Fila ativa" : "Fila desligada"}
            </div>
          </div>

          {/* Mensagem */}
          <div className="space-y-3">
            <div>
              <p className="text-sm font-semibold text-foreground">Mensagem padrão</p>
              <p className="text-[11px] text-muted-foreground mt-0.5">
                Use {"{{nome}}"} para o primeiro nome. *texto* vira negrito no WhatsApp.
              </p>
            </div>

            <div className="flex gap-1.5 overflow-x-auto pb-1">
              {BIRTHDAY_MESSAGE_TEMPLATES.slice(0, 5).map((tpl, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => applyTemplate(tpl)}
                  className="shrink-0 rounded-lg border border-border/60 bg-card px-2.5 py-1.5 text-[10px] font-bold text-muted-foreground hover:border-primary/50 hover:text-primary transition"
                >
                  Modelo {i + 1}
                </button>
              ))}
              <button
                type="button"
                onClick={() => applyTemplate(pickRandomBirthdayMessage())}
                className="shrink-0 inline-flex items-center gap-1 rounded-lg border border-border/60 bg-card px-2.5 py-1.5 text-[10px] font-bold text-muted-foreground hover:border-primary/50 hover:text-primary transition"
              >
                <Shuffle className="w-3 h-3" /> Sortear
              </button>
            </div>

            <Textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              rows={8}
              className="text-xs leading-relaxed resize-none font-sans"
              placeholder="Escreva sua mensagem de aniversário…"
            />

            <div className="rounded-xl border border-accent/30 bg-accent/5 px-3 py-2.5 space-y-1">
              <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-primary">Prévia</p>
              <p className="text-xs text-foreground whitespace-pre-wrap leading-relaxed">
                {fillBirthdayMessage(draft || "…", "Maria")}
              </p>
            </div>

            <div className="flex items-center justify-between gap-2">
              <span className="text-[10px] text-muted-foreground">{draft.length} caracteres</span>
              <Button
                type="button"
                size="sm"
                className="h-9 gap-1.5 rounded-xl bg-accent text-accent-foreground hover:bg-accent/90"
                disabled={!consultantId || savingMsg}
                onClick={saveMessage}
              >
                {savingMsg ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
                Salvar mensagem
              </Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function RetentionCard({
  customers,
  consultantId,
  instanceName,
  isWhapi,
}: {
  customers: Customer[] | undefined;
  consultantId?: string;
  instanceName?: string | null;
  isWhapi?: boolean;
}) {
  const list = customers ?? [];
  const now = new Date();
  const curMonth = now.getMonth() + 1;
  const curDay = now.getDate();

  const [configOpen, setConfigOpen] = useState(false);
  const [preferredTemplate, setPreferredTemplate] = useState(() =>
    getPreferredBirthdayTemplate(consultantId),
  );
  /** Incrementa ao enviar — sincroniza “já hoje” entre nome e botão. */
  const [sentTick, setSentTick] = useState(0);
  const bumpSent = () => setSentTick((n) => n + 1);

  const { data: settings } = useAutomationSettings(consultantId);
  const queueEnabled = !!settings?.auto_wa_aniversariante;

  useEffect(() => {
    setPreferredTemplate(getPreferredBirthdayTemplate(consultantId));
  }, [consultantId]);

  const parados = dedupeByWhatsApp(
    list
      .filter((c) => {
        const s = (c.status || "").toLowerCase();
        const stale = s === "pending" || s === "devolutiva" || s === "lead" || s === "data_complete";
        return stale && daysSince(c.created_at) >= 30;
      })
      .sort((a, b) => daysSince(b.created_at) - daysSince(a.created_at)),
  );

  const withBirth = dedupeByWhatsApp(list)
    .map((c) => ({ c, b: parseBirth(c.data_nascimento) }))
    .filter((x): x is { c: CustomerWithMeta; b: { year: number; month: number; day: number } } => x.b !== null);

  const aniversariantesHoje = withBirth
    .filter((x) => x.b.month === curMonth && x.b.day === curDay)
    .sort((a, b) => (a.c.name || "").localeCompare(b.c.name || ""));

  // "Este mês" exclui quem já está em "Hoje" — evita 2 botões Parabenizar no mesmo dia/número.
  const aniversariantesMes = withBirth
    .filter((x) => x.b.month === curMonth && x.b.day !== curDay)
    .sort((a, b) => a.b.day - b.b.day || (a.c.name || "").localeCompare(b.c.name || ""));

  return (
    <section className="grid grid-cols-1 md:grid-cols-2 gap-4">
      <div className="rounded-2xl border border-border/60 bg-card/60 backdrop-blur overflow-hidden">
        <header className="flex items-center gap-3 px-5 py-4 border-b border-border/40">
          <AlertTriangle className="w-4 h-4 text-destructive" />
          <div>
            <h3 className="font-heading font-black text-sm tracking-tight">REATIVAR CLIENTES PARADOS</h3>
            <p className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
              Sem avanço há +30 dias — clique no nome ou mande um oi
            </p>
          </div>
        </header>
        {parados.length === 0 ? (
          <p className="px-5 py-6 text-sm text-muted-foreground">Nenhum cliente parado. 🎉</p>
        ) : (
          <ol className="divide-y divide-border/40 max-h-[320px] overflow-y-auto">
            {parados.map((c) => (
              <li
                key={c.id}
                className="grid grid-cols-[1fr_auto_auto] items-center gap-3 px-5 py-2.5 hover:bg-muted/30"
              >
                <RetentionCustomerName
                  customer={c}
                  consultantId={consultantId}
                  instanceName={instanceName}
                  isWhapi={isWhapi}
                  templates={REACTIVATION_TEMPLATES}
                  conversationStep="retention_reactivation"
                  sentTick={sentTick}
                  onSent={bumpSent}
                />
                <span className="text-xs tabular-nums text-destructive font-bold">
                  {daysSince(c.created_at)}d
                </span>
                <ReactivationMessageButton
                  customer={c}
                  consultantId={consultantId}
                  instanceName={instanceName}
                  isWhapi={isWhapi}
                  sentTick={sentTick}
                  onSent={bumpSent}
                />
              </li>
            ))}
          </ol>
        )}
      </div>

      <div className="rounded-2xl border border-border/60 bg-card/60 backdrop-blur overflow-hidden">
        <header className="flex items-center gap-3 px-5 py-4 border-b border-border/40">
          <Cake className="w-4 h-4 text-primary shrink-0" />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="font-heading font-black text-sm tracking-tight">ANIVERSARIANTES</h3>
              <span
                className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide ${
                  queueEnabled
                    ? "bg-primary/10 text-primary"
                    : "bg-muted text-muted-foreground"
                }`}
              >
                <span
                  className={`h-1.5 w-1.5 rounded-full ${queueEnabled ? "bg-accent" : "bg-muted-foreground/40"}`}
                />
                {queueEnabled ? "Fila on" : "Fila off"}
              </span>
            </div>
            <p className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
              Clique no nome para enviar · ou configure e parabenize
            </p>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-8 gap-1.5 rounded-xl border-primary/40 text-primary hover:bg-primary/10 shrink-0"
            onClick={() => setConfigOpen(true)}
          >
            <Settings2 className="w-3.5 h-3.5" />
            <span className="hidden sm:inline text-[11px] font-bold">Configurar</span>
          </Button>
        </header>

        <BirthdaySettingsDialog
          open={configOpen}
          onOpenChange={setConfigOpen}
          consultantId={consultantId}
          preferredTemplate={preferredTemplate}
          onPreferredChange={setPreferredTemplate}
        />

        {withBirth.length === 0 ? (
          <p className="px-5 py-6 text-sm text-muted-foreground">Nenhuma data de nascimento cadastrada.</p>
        ) : (
          <div className="divide-y divide-border/40">
            <div className="px-5 py-3">
              <div className="flex items-center gap-2 mb-2">
                <PartyPopper className="w-3.5 h-3.5 text-primary" />
                <span className="text-[10px] uppercase tracking-[0.18em] text-primary font-bold">
                  Hoje ({aniversariantesHoje.length})
                </span>
              </div>
              {aniversariantesHoje.length === 0 ? (
                <p className="text-xs text-muted-foreground">Ninguém faz aniversário hoje.</p>
              ) : (
                <ul className="space-y-1.5 max-h-[200px] overflow-y-auto">
                  {aniversariantesHoje.map(({ c, b }) => (
                    <li key={c.id} className="grid grid-cols-[1fr_auto_auto] items-center gap-2 py-0.5">
                      <RetentionCustomerName
                        customer={c}
                        consultantId={consultantId}
                        instanceName={instanceName}
                        isWhapi={isWhapi}
                        templates={BIRTHDAY_MESSAGE_TEMPLATES}
                        preferredTemplate={preferredTemplate}
                        conversationStep="retention_birthday"
                        sentTick={sentTick}
                        onSent={bumpSent}
                      />
                      <span className="text-xs tabular-nums text-primary font-bold">
                        {ageThisYear(b.year)} anos
                      </span>
                      <BirthdayMessageButton
                        customer={c}
                        consultantId={consultantId}
                        instanceName={instanceName}
                        isWhapi={isWhapi}
                        preferredTemplate={preferredTemplate}
                        sentTick={sentTick}
                        onSent={bumpSent}
                      />
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="px-5 py-3">
              <div className="flex items-center gap-2 mb-2">
                <Cake className="w-3.5 h-3.5 text-muted-foreground" />
                <span className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground font-bold">
                  Resto do mês ({aniversariantesMes.length})
                </span>
              </div>
              {aniversariantesMes.length === 0 ? (
                <p className="text-xs text-muted-foreground">Ninguém este mês.</p>
              ) : (
                <ul className="space-y-1.5 max-h-[280px] overflow-y-auto">
                  {aniversariantesMes.map(({ c, b }) => {
                    return (
                      <li
                        key={c.id}
                        className="grid grid-cols-[1fr_auto_auto_auto] items-center gap-2 py-0.5"
                      >
                        <RetentionCustomerName
                          customer={c}
                          consultantId={consultantId}
                          instanceName={instanceName}
                          isWhapi={isWhapi}
                          templates={BIRTHDAY_MESSAGE_TEMPLATES}
                          preferredTemplate={preferredTemplate}
                          conversationStep="retention_birthday"
                          sentTick={sentTick}
                          onSent={bumpSent}
                        />
                        <span className="text-[11px] tabular-nums text-muted-foreground">
                          {String(b.day).padStart(2, "0")}/{String(b.month).padStart(2, "0")}
                        </span>
                        <span className="text-xs tabular-nums text-primary font-bold w-[52px] text-right">
                          {ageThisYear(b.year)}a
                        </span>
                        <BirthdayMessageButton
                          customer={c}
                          consultantId={consultantId}
                          instanceName={instanceName}
                          isWhapi={isWhapi}
                          preferredTemplate={preferredTemplate}
                          sentTick={sentTick}
                          onSent={bumpSent}
                        />
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
