import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { Loader2, Send } from "lucide-react";
import { VozCampaignShell, VozSection } from "./VozCampaignShell";

interface Props {
  consultantId: string;
}

export function VoiceSmsPanel({ consultantId }: Props) {
  const [phones, setPhones] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  const totalChars = message.length;
  const parts = Math.max(1, Math.ceil(totalChars / 160));
  const phoneList = phones.split(/[\n,;\s]+/).map((s) => s.trim()).filter(Boolean);

  const send = async () => {
    if (!message.trim()) return toast.error("Escreva a mensagem");
    if (phoneList.length === 0) return toast.error("Adicione ao menos 1 telefone");
    setBusy(true);
    try {
      const { data, error } = await supabase.functions.invoke("voice-sms-send", {
        body: { phones: phoneList, message: message.trim(), consultant_id: consultantId },
      });
      if (error) throw new Error(error.message);
      toast.success(`SMS enviado: ${data?.sent ?? phoneList.length} · falha ${data?.failed ?? 0}`);
      setMessage("");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <VozCampaignShell
      title="SMS pela Velip"
      subtitle="Complemento à ligação — 160 caracteres por parte. Ideal para follow-up automático."
      footer={
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-sm" style={{ color: "var(--pe-text-muted)" }}>
            {phoneList.length} destino(s) · {parts} parte(s) por SMS
          </span>
          <Button onClick={() => void send()} disabled={busy || !message.trim() || phoneList.length === 0} style={{ background: "var(--pe-emerald)", color: "#fff" }}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Send className="h-4 w-4 mr-2" />}
            Enviar SMS
          </Button>
        </div>
      }
    >
      <VozSection title="Destinatários">
        <Label>Telefones (um por linha ou separados por vírgula)</Label>
        <Textarea value={phones} onChange={(e) => setPhones(e.target.value)} rows={5} placeholder="55DDNNNNNNNNN" />
      </VozSection>
      <VozSection title="Mensagem">
        <Textarea value={message} onChange={(e) => setMessage(e.target.value)} rows={4} maxLength={480} placeholder="Olá, aqui é da iGreen..." />
        <p className="text-[11px]" style={{ color: "var(--pe-text-muted)" }}>{totalChars}/480 caracteres · {parts} parte(s)</p>
      </VozSection>
    </VozCampaignShell>
  );
}
