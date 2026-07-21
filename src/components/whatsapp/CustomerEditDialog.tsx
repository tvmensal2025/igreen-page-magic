import { useState } from "react";
import {
  Search, MapPin, Zap, User, Save, X, Loader2, Users, ShieldCheck,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from "@/components/ui/use-toast";
import { supabase } from "@/integrations/supabase/client";
import type { TablesUpdate } from "@/integrations/supabase/types";
import type { Customer } from "./customerUtils";
import { isValidBrNationalPhone, toWhatsappCanonical } from "@/lib/captacao/portalPhone";

function SectionLabel({ icon: Icon, title }: { icon: React.ElementType; title: string }) {
  return (
    <div className="flex items-center gap-2 col-span-1 sm:col-span-2 mt-2 mb-1">
      <div className="h-6 w-6 rounded-md bg-primary/10 flex items-center justify-center">
        <Icon className="h-3 w-3 text-primary" />
      </div>
      <span className="text-[11px] font-semibold text-foreground uppercase tracking-wider">{title}</span>
      <div className="flex-1 h-px bg-border" />
    </div>
  );
}

interface CustomerEditDialogProps {
  customer: Customer | null;
  onClose: () => void;
  onSaved: () => void;
}

/**
 * Status possíveis de um cliente. Espelha os valores reais existentes na
 * tabela `customers`. Mantém "Reprovado" (rejected) e "Devolutiva" explícitos
 * para que o admin consiga corrigir um cliente que veio marcado como aprovado
 * mas na verdade foi reprovado.
 */
const STATUS_OPTIONS: { value: string; label: string }[] = [
  { value: "lead", label: "Cliente interessado" },
  { value: "pending", label: "Pendente" },
  { value: "contato_incompleto", label: "Contato incompleto" },
  { value: "awaiting_otp", label: "Aguardando OTP" },
  { value: "awaiting_signature", label: "Aguardando assinatura" },
  { value: "approved", label: "✅ Aprovado" },
  { value: "devolutiva", label: "⚠️ Devolutiva" },
  { value: "rejected", label: "❌ Reprovado" },
  { value: "automation_failed", label: "Falha na automação" },
];

export function CustomerEditDialog({ customer, onClose, onSaved }: CustomerEditDialogProps) {
  const { toast } = useToast();
  const [saving, setSaving] = useState(false);
  const [editForm, setEditForm] = useState<Record<string, string>>(() => {
    if (!customer) return {};
    return {
      name: customer.name || "", cpf: customer.cpf || "", data_nascimento: customer.data_nascimento || "",
      email: customer.email || "", phone_whatsapp: customer.phone_whatsapp, cep: customer.cep || "",
      address_street: customer.address_street || "", address_number: customer.address_number || "",
      address_neighborhood: customer.address_neighborhood || "", address_complement: customer.address_complement || "",
      address_city: customer.address_city || "", address_state: customer.address_state || "",
      numero_instalacao: customer.numero_instalacao || "", electricity_bill_value: customer.electricity_bill_value?.toString() || "",
      status: customer.status || "pending",
      tipo_produto: customer.tipo_produto || "energia",
      customer_referred_by_name: customer.customer_referred_by_name || "",
      customer_referred_by_phone: customer.customer_referred_by_phone || "",
    };
  });

  const updateEdit = (field: string, value: string) => setEditForm((prev) => ({ ...prev, [field]: value }));

  const fetchCep = async () => {
    const cep = (editForm.cep || "").replace(/\D/g, "");
    if (cep.length !== 8) return;
    try {
      const res = await fetch(`https://viacep.com.br/ws/${cep}/json/`);
      const data = await res.json();
      if (!data.erro) {
        setEditForm((prev) => ({
          ...prev,
          address_street: data.logradouro || prev.address_street,
          address_neighborhood: data.bairro || prev.address_neighborhood,
          address_city: data.localidade || prev.address_city,
          address_state: data.uf || prev.address_state,
        }));
      }
    } catch { /* skip */ }
  };

  async function handleSaveEdit() {
    if (!customer) return;
    setSaving(true);
    try {
      const updateData: TablesUpdate<"customers"> = {};
      if (editForm.name) updateData.name = editForm.name;
      if (editForm.cpf) updateData.cpf = editForm.cpf.replace(/\D/g, "");
      if (editForm.data_nascimento) updateData.data_nascimento = editForm.data_nascimento;
      if (editForm.email) updateData.email = editForm.email;
      if (editForm.phone_whatsapp) {
        const canon = toWhatsappCanonical(editForm.phone_whatsapp);
        if (!isValidBrNationalPhone(canon) || canon.length < 12 || canon.length > 13) {
          toast({ title: "Telefone inválido", description: "Use DDD + celular.", variant: "destructive" });
          setSaving(false);
          return;
        }
        updateData.phone_whatsapp = canon;
      }
      if (editForm.cep) updateData.cep = editForm.cep.replace(/\D/g, "");
      updateData.address_street = editForm.address_street || null;
      updateData.address_number = editForm.address_number || null;
      updateData.address_neighborhood = editForm.address_neighborhood || null;
      updateData.address_complement = editForm.address_complement || null;
      updateData.address_city = editForm.address_city || null;
      updateData.address_state = editForm.address_state || null;
      updateData.numero_instalacao = editForm.numero_instalacao || null;
      updateData.electricity_bill_value = editForm.electricity_bill_value ? parseFloat(editForm.electricity_bill_value) : null;
      updateData.status = editForm.status || "pending";
      // Sincroniza o pós-venda quando o admin aprova/reprova pelo popup.
      // - Aprovado: carimba a data de aprovação (marco da esteira 30/60/90/120),
      //   se ainda não houver, e marca como classificação manual.
      // - Reprovado: move o pós-venda para reprovado e zera o marco.
      if (editForm.status === "approved") {
        (updateData as any).pos_venda_stage = "aprovado";
        (updateData as any).pos_venda_manual = true;
        if (!(customer as any).pos_venda_approved_at) {
          (updateData as any).pos_venda_approved_at = new Date().toISOString();
        }
      } else if (editForm.status === "rejected") {
        (updateData as any).pos_venda_stage = "reprovado";
        (updateData as any).pos_venda_manual = true;
        (updateData as any).pos_venda_approved_at = null;
      }
      (updateData as any).tipo_produto = editForm.tipo_produto || "energia";
      (updateData as any).customer_referred_by_name = editForm.customer_referred_by_name || null;
      (updateData as any).customer_referred_by_phone = editForm.customer_referred_by_phone || null;

      const { error } = await supabase.from("customers").update(updateData).eq("id", customer.id);
      if (error) throw error;
      toast({ title: "✅ Cliente atualizado!" });
      onSaved();
      onClose();
    } catch {
      toast({ title: "Erro ao salvar", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={!!customer} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-2xl w-[calc(100vw-1.5rem)] max-h-[90dvh] p-0 gap-0 flex flex-col overflow-hidden">
        <DialogHeader className="px-5 py-4 border-b border-border shrink-0">
          <DialogTitle className="text-base font-bold">Editar Cliente</DialogTitle>
        </DialogHeader>
        <div className="flex-1 overflow-y-auto px-5 py-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <SectionLabel icon={User} title="Dados Pessoais" />
          <div>
            <Label className="text-[11px] text-muted-foreground">Nome</Label>
            <Input value={editForm.name || ""} onChange={(e) => updateEdit("name", e.target.value)} className="h-9 text-xs mt-1 bg-secondary/30 border-border/50" />
          </div>
          <div>
            <Label className="text-[11px] text-muted-foreground">CPF</Label>
            <Input value={editForm.cpf || ""} onChange={(e) => updateEdit("cpf", e.target.value)} className="h-9 text-xs mt-1 bg-secondary/30 border-border/50" />
          </div>
          <div>
            <Label className="text-[11px] text-muted-foreground">Data Nascimento</Label>
            <Input value={editForm.data_nascimento || ""} onChange={(e) => updateEdit("data_nascimento", e.target.value)} placeholder="DD/MM/AAAA" className="h-9 text-xs mt-1 bg-secondary/30 border-border/50" />
          </div>
          <div>
            <Label className="text-[11px] text-muted-foreground">Email</Label>
            <Input value={editForm.email || ""} onChange={(e) => updateEdit("email", e.target.value)} className="h-9 text-xs mt-1 bg-secondary/30 border-border/50" />
          </div>
          <div>
            <Label className="text-[11px] text-muted-foreground">Celular</Label>
            <Input value={editForm.phone_whatsapp || ""} onChange={(e) => updateEdit("phone_whatsapp", e.target.value)} className="h-9 text-xs mt-1 bg-secondary/30 border-border/50" />
          </div>
          <div>
            <Label className="text-[11px] text-muted-foreground">Status</Label>
            <select value={editForm.status || "pending"} onChange={(e) => updateEdit("status", e.target.value)} className="h-9 text-xs mt-1 w-full bg-secondary/30 border border-border/50 rounded-md px-2">
              {STATUS_OPTIONS.map((s) => (
                <option key={s.value} value={s.value}>{s.label}</option>
              ))}
            </select>
          </div>
          <div>
            <Label className="text-[11px] text-muted-foreground">Tipo Produto</Label>
            <select value={editForm.tipo_produto || "energia"} onChange={(e) => updateEdit("tipo_produto", e.target.value)} className="h-9 text-xs mt-1 w-full bg-secondary/30 border border-border/50 rounded-md px-2">
              <option value="energia">⚡ Energia</option>
              <option value="telefonia">📱 Telefonia</option>
            </select>
          </div>

          <SectionLabel icon={MapPin} title="Endereço" />
          <div>
            <Label className="text-[11px] text-muted-foreground">CEP</Label>
            <div className="flex gap-1.5 mt-1">
              <Input value={editForm.cep || ""} onChange={(e) => updateEdit("cep", e.target.value)} placeholder="00000-000" className="h-9 text-xs flex-1 bg-secondary/30 border-border/50" onBlur={fetchCep} />
              <Button size="icon" variant="outline" className="h-9 w-9 shrink-0" onClick={fetchCep}>
                <Search className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>
          <div>
            <Label className="text-[11px] text-muted-foreground">Rua</Label>
            <Input value={editForm.address_street || ""} onChange={(e) => updateEdit("address_street", e.target.value)} className="h-9 text-xs mt-1 bg-secondary/30 border-border/50" />
          </div>
          <div>
            <Label className="text-[11px] text-muted-foreground">Número</Label>
            <Input value={editForm.address_number || ""} onChange={(e) => updateEdit("address_number", e.target.value)} className="h-9 text-xs mt-1 bg-secondary/30 border-border/50" />
          </div>
          <div>
            <Label className="text-[11px] text-muted-foreground">Bairro</Label>
            <Input value={editForm.address_neighborhood || ""} onChange={(e) => updateEdit("address_neighborhood", e.target.value)} className="h-9 text-xs mt-1 bg-secondary/30 border-border/50" />
          </div>
          <div>
            <Label className="text-[11px] text-muted-foreground">Complemento</Label>
            <Input value={editForm.address_complement || ""} onChange={(e) => updateEdit("address_complement", e.target.value)} className="h-9 text-xs mt-1 bg-secondary/30 border-border/50" />
          </div>
          <div>
            <Label className="text-[11px] text-muted-foreground">Cidade / UF</Label>
            <div className="flex gap-1.5 mt-1">
              <Input value={editForm.address_city || ""} onChange={(e) => updateEdit("address_city", e.target.value)} className="h-9 text-xs flex-1 bg-secondary/30 border-border/50" />
              <Input value={editForm.address_state || ""} onChange={(e) => updateEdit("address_state", e.target.value.toUpperCase())} className="h-9 text-xs w-16 bg-secondary/30 border-border/50" maxLength={2} />
            </div>
          </div>

          <SectionLabel icon={Users} title="Indicação" />
          <div>
            <Label className="text-[11px] text-muted-foreground">Indicado por (nome)</Label>
            <Input value={editForm.customer_referred_by_name || ""} onChange={(e) => updateEdit("customer_referred_by_name", e.target.value)} placeholder="Quem indicou este cliente" className="h-9 text-xs mt-1 bg-secondary/30 border-border/50" />
          </div>
          <div>
            <Label className="text-[11px] text-muted-foreground">Telefone do indicador</Label>
            <Input value={editForm.customer_referred_by_phone || ""} onChange={(e) => updateEdit("customer_referred_by_phone", e.target.value)} placeholder="(00) 00000-0000" className="h-9 text-xs mt-1 bg-secondary/30 border-border/50" />
          </div>

          <SectionLabel icon={Zap} title="Dados de Energia" />
          <div>
            <Label className="text-[11px] text-muted-foreground">Nº Instalação</Label>
            <Input value={editForm.numero_instalacao || ""} onChange={(e) => updateEdit("numero_instalacao", e.target.value)} className="h-9 text-xs mt-1 bg-secondary/30 border-border/50" />
          </div>
          <div>
            <Label className="text-[11px] text-muted-foreground">Média de Consumo (R$)</Label>
            <Input type="number" value={editForm.electricity_bill_value || ""} onChange={(e) => updateEdit("electricity_bill_value", e.target.value)} className="h-9 text-xs mt-1 bg-secondary/30 border-border/50" />
          </div>

          <SectionLabel icon={ShieldCheck} title="Status do Cadastro (Portal)" />
          <div className="sm:col-span-2">
            <Label className="text-[11px] text-muted-foreground">Etapa atual</Label>
            <Input
              value={(customer as any)?.conversation_step || "—"}
              readOnly
              className="h-9 text-xs mt-1 bg-secondary/20 border-border/40 font-mono"
            />
          </div>
          <div>
            <Label className="text-[11px] text-muted-foreground">Código de confirmação</Label>
            <Input
              value={(customer as any)?.otp_code || "—"}
              readOnly
              className="h-9 text-xs mt-1 bg-secondary/20 border-border/40 font-mono"
            />
          </div>
          <div>
            <Label className="text-[11px] text-muted-foreground">Código recebido em</Label>
            <Input
              value={(customer as any)?.otp_received_at ? new Date((customer as any).otp_received_at).toLocaleString("pt-BR") : "—"}
              readOnly
              className="h-9 text-xs mt-1 bg-secondary/20 border-border/40"
            />
          </div>
          <div className="sm:col-span-2">
            <Label className="text-[11px] text-muted-foreground">Link Validação Facial</Label>
            <Input
              value={(customer as any)?.link_facial || (customer as any)?.link_assinatura || "—"}
              readOnly
              className="h-9 text-xs mt-1 bg-secondary/20 border-border/40"
            />
          </div>
          <div className="sm:col-span-2">
            <Label className="text-[11px] text-muted-foreground">Facial confirmada em</Label>
            <Input
              value={(customer as any)?.facial_confirmed_at ? new Date((customer as any).facial_confirmed_at).toLocaleString("pt-BR") : "—"}
              readOnly
              className="h-9 text-xs mt-1 bg-secondary/20 border-border/40"
            />
          </div>
        </div>
        </div>

        <div className="flex justify-end gap-2 px-5 py-4 border-t border-border shrink-0 bg-background">
          <Button variant="outline" size="sm" className="h-9 text-xs px-4 gap-1" onClick={onClose}>
            <X className="h-3 w-3" /> Cancelar
          </Button>
          <Button size="sm" className="h-9 text-xs px-5 gap-1.5 font-semibold shadow-lg shadow-primary/20" onClick={handleSaveEdit} disabled={saving}>
            {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
            Salvar Alterações
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
