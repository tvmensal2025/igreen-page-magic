/**
 * Painel SMS Velip (MakeSMS) — templates editáveis + {{nome}} resolvido pelo telefone.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Loader2, Send, Users, X, RefreshCw, Save, Trash2, Plus } from "lucide-react";
import { normalizeBrazilPhone } from "@/lib/phone";
import { VozCampaignShell, VozSection } from "./VozCampaignShell";
import type { VozCustomer } from "./VozContactPickerDialog";
import { firstName, resolveNameByPhone } from "./voiceContactResolve";

interface Props {
  consultantId: string;
  customers?: VozCustomer[];
}

interface SmsLogRow {
  id: string;
  phone: string;
  message: string;
  status: string;
  delivery_status: string | null;
  created_at: string;
  error: string | null;
}

interface SmsTemplate {
  id: string;
  label: string;
  text: string;
}

const DEFAULT_SMS_TEMPLATES: SmsTemplate[] = [
  {
    id: "followup",
    label: "Follow-up ligação",
    text: "Oi {{nome}}, tentei te ligar agora. Me chama no WhatsApp quando puder. iGreen",
  },
  {
    id: "economia",
    label: "Economia energia",
    text: "Oi {{nome}}, aqui é da iGreen. Ainda da pra reduzir sua conta de luz. Me responde que te explico.",
  },
  {
    id: "retorno",
    label: "Retorno rápido",
    text: "{{nome}}, tudo bem? Fico no aguardo do seu retorno pra te ajudar com a conta de luz. iGreen",
  },
];

function storageKey(consultantId: string) {
  return `voice_sms_templates_v1_${consultantId}`;
}

function loadTemplates(consultantId: string): SmsTemplate[] {
  try {
    const raw = localStorage.getItem(storageKey(consultantId));
    if (!raw) return DEFAULT_SMS_TEMPLATES.map((t) => ({ ...t }));
    const parsed = JSON.parse(raw) as SmsTemplate[];
    if (!Array.isArray(parsed) || parsed.length === 0) {
      return DEFAULT_SMS_TEMPLATES.map((t) => ({ ...t }));
    }
    return parsed.filter((t) => t?.id && t?.label && typeof t.text === "string");
  } catch {
    return DEFAULT_SMS_TEMPLATES.map((t) => ({ ...t }));
  }
}

function persistTemplates(consultantId: string, list: SmsTemplate[]) {
  try {
    localStorage.setItem(storageKey(consultantId), JSON.stringify(list));
  } catch { /* ignore quota */ }
}

function renderPreview(text: string, name: string | null | undefined): string {
  const nome = firstName(name) || "cliente";
  return text.replace(/\{\{\s*nome\s*\}\}/gi, nome).replace(/\{\s*nome\s*\}/gi, nome);
}

function fmtPhone(raw: string): string {
  const d = String(raw || "").replace(/\D/g, "");
  const local = d.startsWith("55") && d.length >= 12 ? d.slice(2) : d;
  if (local.length < 10) return raw;
  return `(${local.slice(0, 2)}) ${local.slice(2, 7)}-${local.slice(7)}`;
}

export function VoiceSmsPanel({ consultantId, customers = [] }: Props) {
  const [phones, setPhones] = useState("");
  const [templates, setTemplates] = useState<SmsTemplate[]>(() => loadTemplates(consultantId));
  const [activeTplId, setActiveTplId] = useState<string>(() => loadTemplates(consultantId)[0]?.id ?? "");
  const [tplLabel, setTplLabel] = useState(() => loadTemplates(consultantId)[0]?.label ?? "Meu template");
  const [message, setMessage] = useState(() => loadTemplates(consultantId)[0]?.text ?? "");
  const [busy, setBusy] = useState(false);
  const [picked, setPicked] = useState<VozCustomer[]>([]);
  const [logs, setLogs] = useState<SmsLogRow[]>([]);

  useEffect(() => {
    const list = loadTemplates(consultantId);
    setTemplates(list);
    const first = list[0];
    if (first) {
      setActiveTplId(first.id);
      setTplLabel(first.label);
      setMessage(first.text);
    }
  }, [consultantId]);

  const loadLogs = useCallback(async () => {
    const { data } = await (supabase as any)
      .from("voice_sms_log")
      .select("id, phone, message, status, delivery_status, created_at, error")
      .eq("consultant_id", consultantId)
      .order("created_at", { ascending: false })
      .limit(15);
    setLogs((data as SmsLogRow[]) ?? []);
  }, [consultantId]);

  useEffect(() => {
    void loadLogs();
  }, [loadLogs]);

  const totalChars = message.length;
  const parts = Math.max(1, Math.ceil(totalChars / 160));

  const phoneOnlyList = phones
    .split(/[\n,;]+/)
    .map((s) => s.trim())
    .filter(Boolean);

  const recipients = useMemo(() => {
    const out: { phone: string; name?: string | null }[] = [];
    const seen = new Set<string>();
    for (const c of picked) {
      const phone = normalizeBrazilPhone(c.phone_whatsapp) || String(c.phone_whatsapp || "").replace(/\D/g, "");
      if (!phone || seen.has(phone)) continue;
      seen.add(phone);
      out.push({ phone, name: c.name });
    }
    for (const raw of phoneOnlyList) {
      const phone = normalizeBrazilPhone(raw) || raw.replace(/\D/g, "");
      if (!phone || seen.has(phone)) continue;
      seen.add(phone);
      const name = resolveNameByPhone(phone, customers);
      out.push({ phone, name });
    }
    return out;
  }, [picked, phoneOnlyList, customers]);

  const previewName =
    recipients.find((r) => r.name)?.name ||
    picked[0]?.name ||
    customers[0]?.name ||
    "Maria";
  const preview = renderPreview(message, previewName);

  const selectTemplate = (t: SmsTemplate) => {
    setActiveTplId(t.id);
    setTplLabel(t.label);
    setMessage(t.text);
  };

  const saveTemplates = (next: SmsTemplate[]) => {
    setTemplates(next);
    persistTemplates(consultantId, next);
  };

  const updateActiveTemplate = () => {
    if (!message.trim()) return toast.error("Escreva a mensagem do template");
    const label = tplLabel.trim() || "Template";
    if (!activeTplId) {
      const created: SmsTemplate = {
        id: `tpl_${Date.now()}`,
        label,
        text: message.trim(),
      };
      saveTemplates([created, ...templates]);
      setActiveTplId(created.id);
      toast.success("Template criado");
      return;
    }
    const next = templates.map((t) =>
      t.id === activeTplId ? { ...t, label, text: message.trim() } : t,
    );
    if (!next.some((t) => t.id === activeTplId)) {
      next.unshift({ id: activeTplId, label, text: message.trim() });
    }
    saveTemplates(next);
    toast.success("Template atualizado");
  };

  const saveAsNewTemplate = () => {
    if (!message.trim()) return toast.error("Escreva a mensagem");
    const created: SmsTemplate = {
      id: `tpl_${Date.now()}`,
      label: (tplLabel.trim() || "Novo template").slice(0, 40),
      text: message.trim(),
    };
    saveTemplates([created, ...templates]);
    setActiveTplId(created.id);
    setTplLabel(created.label);
    toast.success("Template salvo");
  };

  const deleteActiveTemplate = () => {
    if (!activeTplId) return;
    if (templates.length <= 1) {
      toast.message("Mantenha ao menos 1 template");
      return;
    }
    const next = templates.filter((t) => t.id !== activeTplId);
    saveTemplates(next);
    const first = next[0];
    setActiveTplId(first.id);
    setTplLabel(first.label);
    setMessage(first.text);
    toast.success("Template removido");
  };

  const addRecent = (days: number) => {
    const cutoff = Date.now() - days * 86400_000;
    const list = customers.filter((c) => {
      const ts = Date.parse(String(c.updated_at || c.created_at || ""));
      return Number.isFinite(ts) && ts >= cutoff && c.phone_whatsapp;
    });
    if (list.length === 0) {
      toast.message(`Nenhum contato nos últimos ${days} dia(s)`);
      return;
    }
    setPicked((prev) => {
      const map = new Map(prev.map((p) => [p.id, p]));
      for (const c of list) map.set(c.id, c);
      return [...map.values()];
    });
    toast.success(`${list.length} contato(s) dos últimos ${days}d adicionados`);
  };

  const send = async () => {
    if (!message.trim()) return toast.error("Escreva a mensagem");
    if (recipients.length === 0) return toast.error("Adicione ao menos 1 telefone ou contato");
    if (totalChars > 160) {
      toast.message("Texto > 160 chars: o SMS corta em 1 parte. Prefira enxugar.");
    }
    setBusy(true);
    try {
      const { data, error } = await supabase.functions.invoke("voice-sms-send", {
        body: {
          recipients,
          message: message.trim(),
          consultant_id: consultantId,
        },
      });
      if (error) throw new Error(error.message);
      if (data?.error && !data?.sent) {
        throw new Error(String(data.message || data.error));
      }
      const sent = Number(data?.sent ?? 0);
      const failed = Number(data?.failed ?? 0);
      if (sent === 0) {
        const firstErr = Array.isArray(data?.results)
          ? (data.results.find((r: { error?: string }) => r?.error)?.error as string | undefined)
          : undefined;
        throw new Error(firstErr || data?.message || "Falha ao enviar SMS");
      }
      toast.success(
        failed > 0
          ? `SMS: ${sent} enviado(s), ${failed} falha(s)`
          : `SMS enviado com sucesso (${sent})`,
      );
      if (failed === 0) setPhones("");
      await loadLogs();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <VozCampaignShell
      title="SMS pelo iGreen Fone"
      subtitle="Templates editáveis · {{nome}} puxa o nome do contato pelo número. DELIVRD = entregue."
      footer={
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-sm" style={{ color: "var(--pe-text-muted)" }}>
            {recipients.length} destino(s) · {parts} parte(s) · {totalChars} chars
          </span>
          <Button
            onClick={() => void send()}
            disabled={busy || !message.trim() || recipients.length === 0}
            style={{ background: "var(--pe-emerald)", color: "#fff" }}
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Send className="h-4 w-4 mr-2" />}
            Enviar SMS
          </Button>
        </div>
      }
    >
      <VozSection title="Templates (editar e salvar)">
        <div className="flex flex-wrap gap-1.5">
          {templates.map((t) => (
            <Button
              key={t.id}
              type="button"
              size="sm"
              variant={activeTplId === t.id ? "default" : "outline"}
              className="h-8"
              style={activeTplId === t.id ? { background: "var(--pe-emerald)", color: "#fff" } : undefined}
              onClick={() => selectTemplate(t)}
            >
              {t.label}
            </Button>
          ))}
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="h-8"
            onClick={() => setMessage((v) => (v.includes("{{nome}}") ? v : `Oi {{nome}}, ${v}`))}
          >
            inserir {"{{nome}}"}
          </Button>
        </div>
        <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
          <div className="space-y-1">
            <Label>Nome do template</Label>
            <Input
              value={tplLabel}
              onChange={(e) => setTplLabel(e.target.value.slice(0, 40))}
              placeholder="Ex: Follow-up personalizado"
            />
          </div>
          <div className="flex flex-wrap items-end gap-1.5">
            <Button type="button" size="sm" variant="outline" className="h-9 gap-1" onClick={updateActiveTemplate}>
              <Save className="h-3.5 w-3.5" /> Salvar
            </Button>
            <Button type="button" size="sm" variant="outline" className="h-9 gap-1" onClick={saveAsNewTemplate}>
              <Plus className="h-3.5 w-3.5" /> Novo
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="h-9 gap-1 text-destructive"
              onClick={deleteActiveTemplate}
              disabled={templates.length <= 1}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      </VozSection>

      <VozSection title="Contatos (com nome)">
        <div className="flex flex-wrap gap-1.5">
          {[1, 2, 3, 7].map((d) => (
            <Button key={d} type="button" size="sm" variant="outline" className="h-8" onClick={() => addRecent(d)}>
              <Users className="h-3.5 w-3.5 mr-1" />
              Últimos {d}d
            </Button>
          ))}
          {picked.length > 0 && (
            <Button type="button" size="sm" variant="ghost" className="h-8" onClick={() => setPicked([])}>
              Limpar seleção
            </Button>
          )}
        </div>
        {picked.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mt-2">
            {picked.slice(0, 20).map((c) => (
              <Badge
                key={c.id}
                variant="secondary"
                className="gap-1 pr-1"
                style={{ background: "var(--pe-emerald-10)", color: "var(--pe-emerald-strong)" }}
              >
                <span className="max-w-[140px] truncate">{firstName(c.name) || c.phone_whatsapp}</span>
                <button type="button" className="rounded p-0.5" onClick={() => setPicked((prev) => prev.filter((x) => x.id !== c.id))}>
                  <X className="h-3 w-3" />
                </button>
              </Badge>
            ))}
            {picked.length > 20 && <Badge variant="outline">+{picked.length - 20}</Badge>}
          </div>
        )}
      </VozSection>

      <VozSection title="Telefones (nome automático)">
        <Label>Um por linha ou separados por vírgula — o sistema busca o nome na sua base</Label>
        <Textarea value={phones} onChange={(e) => setPhones(e.target.value)} rows={3} placeholder="11 99999-9999" />
        {recipients.filter((r) => !picked.some((p) => {
          const ph = normalizeBrazilPhone(p.phone_whatsapp) || String(p.phone_whatsapp || "").replace(/\D/g, "");
          return ph === r.phone;
        })).length > 0 && (
          <div className="flex flex-wrap gap-1.5 mt-2">
            {recipients
              .filter((r) => !picked.some((p) => {
                const ph = normalizeBrazilPhone(p.phone_whatsapp) || String(p.phone_whatsapp || "").replace(/\D/g, "");
                return ph === r.phone;
              }))
              .slice(0, 12)
              .map((r) => (
                <Badge
                  key={r.phone}
                  variant="outline"
                  className="gap-1"
                  style={r.name ? { borderColor: "var(--pe-emerald-20)", color: "var(--pe-emerald-strong)" } : undefined}
                >
                  {r.name ? `${firstName(r.name)} · ${fmtPhone(r.phone)}` : `${fmtPhone(r.phone)} · sem nome`}
                </Badge>
              ))}
          </div>
        )}
      </VozSection>

      <VozSection title="Mensagem">
        <Textarea
          value={message}
          onChange={(e) => setMessage(e.target.value.slice(0, 480))}
          rows={4}
          maxLength={480}
          placeholder="Oi {{nome}}, aqui é da iGreen…"
        />
        <p className="text-[11px]" style={{ color: "var(--pe-text-muted)" }}>
          Prévia ({firstName(previewName) || "cliente"}): {preview.slice(0, 140)}
          {preview.length > 140 ? "…" : ""}
        </p>
      </VozSection>

      <VozSection title="Últimos envios">
        <div className="flex justify-end mb-2">
          <Button type="button" size="sm" variant="ghost" className="h-7 gap-1" onClick={() => void loadLogs()}>
            <RefreshCw className="h-3 w-3" /> Atualizar
          </Button>
        </div>
        {logs.length === 0 ? (
          <p className="text-sm" style={{ color: "var(--pe-text-muted)" }}>Nenhum SMS registrado ainda.</p>
        ) : (
          <ul className="space-y-2">
            {logs.map((row) => {
              const ok = row.status === "delivered" || row.delivery_status === "DELIVRD" || row.status === "sent";
              return (
                <li key={row.id} className="rounded border px-3 py-2 text-sm" style={{ borderColor: "var(--pe-border)" }}>
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium">{fmtPhone(row.phone)}</span>
                    <Badge variant={ok ? "default" : "destructive"}>
                      {row.delivery_status === "DELIVRD" || row.status === "delivered"
                        ? "Entregue"
                        : row.status === "sent"
                          ? "Enviado"
                          : row.status}
                    </Badge>
                  </div>
                  <p className="text-xs mt-1 line-clamp-2" style={{ color: "var(--pe-text-muted)" }}>{row.message}</p>
                  <p className="text-[10px] mt-1" style={{ color: "var(--pe-text-muted)" }}>
                    {new Date(row.created_at).toLocaleString("pt-BR")}
                    {row.error ? ` · ${row.error}` : ""}
                  </p>
                </li>
              );
            })}
          </ul>
        )}
      </VozSection>
    </VozCampaignShell>
  );
}
