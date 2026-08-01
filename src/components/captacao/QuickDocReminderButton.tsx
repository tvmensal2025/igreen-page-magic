/**
 * Agendamento rápido de lembrete no WhatsApp para documento / conta / comprovante em falta.
 * Grava em `scheduled_messages` (mesmo canal do Hub: Whapi ou Evolution).
 */
import { useMemo, useState } from "react";
import { CalendarClock, Loader2 } from "lucide-react";
import { toast } from "@/components/ui/sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { supabase } from "@/integrations/supabase/client";
import {
  resolveScheduleChannel,
  scheduleChannelBlockedReason,
} from "@/lib/scheduleChannel";
import {
  formatPersonName,
  isAddressableNameSource,
  isUsableCustomerName,
} from "@/lib/customerDisplayName";

export type DocReminderKind = "documento" | "conta_energia" | "comprovante";

const KIND_META: Record<DocReminderKind, { label: string; emoji: string; short: string }> = {
  documento: { label: "Documento (RG/CNH)", emoji: "🪪", short: "documento (RG/CNH frente e verso)" },
  conta_energia: { label: "Conta de energia", emoji: "⚡", short: "conta de energia" },
  comprovante: { label: "Comprovante / boleto", emoji: "🧾", short: "comprovante do boleto" },
};

type WhenMode = "1h" | "2h" | "4h" | "amanha9" | "custom";

const WHEN_PRESETS: { id: Exclude<WhenMode, "custom">; label: string }[] = [
  { id: "1h", label: "1h" },
  { id: "2h", label: "2h" },
  { id: "4h", label: "4h" },
  { id: "amanha9", label: "Amanhã 9h" },
];

type MsgTemplateId = "amigavel" | "direto" | "urgente" | "livre";

const MSG_TEMPLATES: { id: MsgTemplateId; label: string; emoji: string }[] = [
  { id: "amigavel", label: "Amigável", emoji: "😊" },
  { id: "direto", label: "Direto", emoji: "📌" },
  { id: "urgente", label: "Urgente", emoji: "⏰" },
  { id: "livre", label: "Outra", emoji: "✏️" },
];

function toLocalDatetimeValue(d: Date) {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

function whenFromPreset(id: Exclude<WhenMode, "custom">): Date {
  if (id === "amanha9") {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    d.setHours(9, 0, 0, 0);
    return d;
  }
  const hours = id === "1h" ? 1 : id === "2h" ? 2 : 4;
  const d = new Date(Date.now() + hours * 60 * 60 * 1000);
  d.setSeconds(0, 0);
  return d;
}

function safeGreetingFirstName(name?: string | null, nameSource?: string | null): string {
  if (!isAddressableNameSource(nameSource)) return "";
  if (!isUsableCustomerName(name)) return "";
  const full = formatPersonName(String(name));
  return full.split(/\s+/)[0] || "";
}

function formatMissingList(kinds: DocReminderKind[]): string {
  const parts = kinds.map((k) => `${KIND_META[k].emoji} ${KIND_META[k].short}`);
  if (parts.length === 1) return parts[0];
  if (parts.length === 2) return `${parts[0]} e ${parts[1]}`;
  return `${parts.slice(0, -1).join(", ")} e ${parts[parts.length - 1]}`;
}

function buildReminderText(
  kinds: DocReminderKind[],
  firstName: string,
  template: Exclude<MsgTemplateId, "livre">,
): string {
  const list = formatMissingList(kinds);
  const hi = firstName ? `Oi ${firstName}! 👋` : "Oi! 👋";

  if (template === "direto") {
    return [
      hi,
      "",
      `📌 Ainda falta no cadastro:`,
      list,
      "",
      "Pode me enviar por aqui quando puder? ✅",
    ].join("\n");
  }

  if (template === "urgente") {
    return [
      hi,
      "",
      "⏰ Passando pra lembrar com carinho:",
      `Ainda precisamos de ${list}.`,
      "",
      "Assim que enviar, seguimos com o cadastro! 🚀",
    ].join("\n");
  }

  // amigavel
  return [
    hi,
    "",
    "😊 Passando pra lembrar:",
    `Ainda falta ${list}.`,
    "",
    "Pode me mandar quando puder? Muito obrigado! 🙏",
  ].join("\n");
}

export function detectMissingDocKinds(customer: Record<string, unknown> | null | undefined): DocReminderKind[] {
  if (!customer) return ["documento", "conta_energia"];
  const missing: DocReminderKind[] = [];
  const front = customer.document_front_url;
  const back = customer.document_back_url;
  if (!front || !back) missing.push("documento");
  if (!customer.electricity_bill_photo_url) missing.push("conta_energia");
  const wantsBoleto =
    customer.contaunica_answered === true && customer.contaunica === true;
  if (wantsBoleto && !customer.electricity_boleto_photo_url) missing.push("comprovante");
  return missing;
}

interface Props {
  phone: string | null | undefined;
  consultantId: string;
  customerName?: string | null;
  nameSource?: string | null;
  customer?: Record<string, unknown> | null;
  instanceName?: string | null;
  isWhapi?: boolean;
  isConnected?: boolean;
  className?: string;
}

export function QuickDocReminderButton({
  phone,
  consultantId,
  customerName,
  nameSource,
  customer,
  instanceName,
  isWhapi = false,
  isConnected,
  className,
}: Props) {
  const missing = useMemo(() => detectMissingDocKinds(customer), [customer]);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState<DocReminderKind[]>([]);
  const [whenMode, setWhenMode] = useState<WhenMode>("2h");
  const [customWhen, setCustomWhen] = useState("");
  const [msgTemplate, setMsgTemplate] = useState<MsgTemplateId>("amigavel");
  const [text, setText] = useState("");

  const firstName = safeGreetingFirstName(customerName, nameSource);
  const hasMissing = missing.length > 0;
  const minDatetime = toLocalDatetimeValue(new Date(Date.now() + 60_000));

  const applyTemplate = (kinds: DocReminderKind[], template: MsgTemplateId) => {
    if (template === "livre") return;
    if (kinds.length === 0) return;
    setText(buildReminderText(kinds, firstName, template));
  };

  const openDialog = () => {
    const initial = missing.length > 0 ? missing : (["documento"] as DocReminderKind[]);
    setSelected(initial);
    setWhenMode("2h");
    setCustomWhen(toLocalDatetimeValue(whenFromPreset("2h")));
    setMsgTemplate("amigavel");
    setText(buildReminderText(initial, firstName, "amigavel"));
    setOpen(true);
  };

  const toggleKind = (kind: DocReminderKind, on: boolean) => {
    const next = on
      ? [...selected.filter((k) => k !== kind), kind]
      : selected.filter((k) => k !== kind);
    const ordered = (["documento", "conta_energia", "comprovante"] as DocReminderKind[]).filter((k) =>
      next.includes(k),
    );
    setSelected(ordered);
    if (msgTemplate !== "livre" && ordered.length > 0) {
      applyTemplate(ordered, msgTemplate);
    }
  };

  const selectWhenPreset = (id: Exclude<WhenMode, "custom">) => {
    setWhenMode(id);
    setCustomWhen(toLocalDatetimeValue(whenFromPreset(id)));
  };

  const selectMsgTemplate = (id: MsgTemplateId) => {
    setMsgTemplate(id);
    if (id !== "livre" && selected.length > 0) {
      setText(buildReminderText(selected, firstName, id));
    }
  };

  const resolveWhen = (): Date | null => {
    if (whenMode === "custom" || customWhen) {
      const at = new Date(customWhen);
      if (Number.isNaN(at.getTime())) return null;
      return at;
    }
    return whenFromPreset(whenMode);
  };

  const submit = async () => {
    if (!phone || /sem_celular/i.test(phone)) {
      toast.error("Sem telefone válido");
      return;
    }
    if (selected.length === 0) {
      toast.error("Escolha pelo menos um item");
      return;
    }
    const message = text.trim();
    if (!message) {
      toast.error("Escreva a mensagem do lembrete");
      return;
    }
    const when = resolveWhen();
    if (!when || when.getTime() <= Date.now()) {
      toast.error("Escolha um dia e horário no futuro");
      return;
    }

    const channelReady = resolveScheduleChannel({
      isWhapi,
      instanceName,
      isConnected: isConnected ?? (isWhapi ? true : undefined),
    });
    const blocked = scheduleChannelBlockedReason(channelReady);
    if (!channelReady.ok) {
      toast.error(blocked || "WhatsApp não conectado para agendar");
      return;
    }

    setBusy(true);
    try {
      const digits = phone.replace(/\D/g, "");
      const remoteJid = `${digits}@s.whatsapp.net`;
      const { data: auth } = await supabase.auth.getUser();
      const { error } = await supabase.from("scheduled_messages").insert({
        consultant_id: consultantId,
        instance_name: channelReady.instanceName,
        remote_jid: remoteJid,
        message_text: message,
        scheduled_at: when.toISOString(),
        created_by: auth?.user?.id ?? consultantId,
      });
      if (error) throw error;
      toast.success(
        `Lembrete agendado para ${when.toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })}`,
      );
      setOpen(false);
    } catch (e) {
      toast.error((e as Error).message || "Falha ao agendar lembrete");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className={className}
        onClick={openDialog}
        disabled={!phone || /sem_celular/i.test(phone || "")}
        title={
          hasMissing
            ? `Agendar lembrete: ${missing.map((k) => KIND_META[k].label).join(", ")}`
            : "Agendar lembrete de documento / conta / comprovante"
        }
      >
        <CalendarClock className="h-3.5 w-3.5" />
        <span className="ml-1 text-[11px] font-semibold">
          {hasMissing ? `Lembrar (${missing.length})` : "Lembrar doc"}
        </span>
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <CalendarClock className="h-4 w-4" /> Agendar lembrete
            </DialogTitle>
            <DialogDescription>
              WhatsApp lembrando o que falta no cadastro.
              {hasMissing
                ? ` Em falta: ${missing.map((k) => `${KIND_META[k].emoji} ${KIND_META[k].label}`).join(" · ")}.`
                : " Escolha o que lembrar."}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <div className="space-y-2">
              <Label className="text-xs">O que falta</Label>
              {(Object.keys(KIND_META) as DocReminderKind[]).map((kind) => (
                <label key={kind} className="flex items-center gap-2 text-sm cursor-pointer">
                  <Checkbox
                    checked={selected.includes(kind)}
                    onCheckedChange={(v) => toggleKind(kind, v === true)}
                  />
                  <span>
                    {KIND_META[kind].emoji} {KIND_META[kind].label}
                    {missing.includes(kind) ? (
                      <span className="ml-1 text-[10px] font-semibold text-amber-700">falta</span>
                    ) : null}
                  </span>
                </label>
              ))}
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs">Quando</Label>
              <div className="flex flex-wrap gap-1.5">
                {WHEN_PRESETS.map((p) => (
                  <Button
                    key={p.id}
                    type="button"
                    size="sm"
                    variant={whenMode === p.id ? "default" : "outline"}
                    className="h-7 rounded-full text-[11px] px-2.5"
                    onClick={() => selectWhenPreset(p.id)}
                  >
                    {p.label}
                  </Button>
                ))}
                <Button
                  type="button"
                  size="sm"
                  variant={whenMode === "custom" ? "default" : "outline"}
                  className="h-7 rounded-full text-[11px] px-2.5"
                  onClick={() => {
                    setWhenMode("custom");
                    if (!customWhen) setCustomWhen(toLocalDatetimeValue(whenFromPreset("2h")));
                  }}
                >
                  Personalizado
                </Button>
              </div>
              <Input
                type="datetime-local"
                min={minDatetime}
                value={customWhen}
                onChange={(e) => {
                  setCustomWhen(e.target.value);
                  setWhenMode("custom");
                }}
                className="h-9 text-sm"
              />
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs">Modelo da mensagem</Label>
              <div className="flex flex-wrap gap-1.5">
                {MSG_TEMPLATES.map((t) => (
                  <Button
                    key={t.id}
                    type="button"
                    size="sm"
                    variant={msgTemplate === t.id ? "default" : "outline"}
                    className="h-7 rounded-full text-[11px] px-2.5"
                    onClick={() => selectMsgTemplate(t.id)}
                  >
                    {t.emoji} {t.label}
                  </Button>
                ))}
              </div>
              <Textarea
                value={text}
                onChange={(e) => {
                  setText(e.target.value);
                  setMsgTemplate("livre");
                }}
                rows={6}
                className="text-sm resize-none leading-relaxed"
                placeholder="Escreva ou escolha um modelo acima…"
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)} disabled={busy}>
              Cancelar
            </Button>
            <Button onClick={() => void submit()} disabled={busy || selected.length === 0}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <CalendarClock className="h-4 w-4 mr-2" />}
              Agendar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
