import { useState, useEffect, useCallback } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import type { TablesInsert } from "@/integrations/supabase/types";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Search, Check, MapPin, CreditCard, Zap, User } from "lucide-react";
import { isValidBrNationalPhone, toWhatsappCanonical } from "@/lib/captacao/portalPhone";

interface AddCustomerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  phone: string;
  name: string | null;
  consultantId: string;
  onAdded: () => void;
}

function formatPhone(raw: string): string {
  const d = raw.replace(/\D/g, "");
  if (d.length <= 2) return d;
  if (d.length <= 4) return `(${d.slice(0, 2)}) ${d.slice(2)}`;
  if (d.length <= 9) return `(${d.slice(0, 2)}) ${d.slice(2, 3)} ${d.slice(3)}`;
  if (d.length <= 11) return `(${d.slice(0, 2)}) ${d.slice(2, 3)} ${d.slice(3, 7)}-${d.slice(7)}`;
  // With country code (55)
  if (d.length <= 13) return `+${d.slice(0, 2)} (${d.slice(2, 4)}) ${d.slice(4, 5)} ${d.slice(5, 9)}-${d.slice(9)}`;
  return `+${d.slice(0, 2)} (${d.slice(2, 4)}) ${d.slice(4, 5)} ${d.slice(5, 9)}-${d.slice(9, 13)}`;
}

function formatCpf(raw: string): string {
  const d = raw.replace(/\D/g, "").slice(0, 11);
  if (d.length <= 3) return d;
  if (d.length <= 6) return `${d.slice(0, 3)}.${d.slice(3)}`;
  if (d.length <= 9) return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6)}`;
  return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`;
}

function formatCep(raw: string): string {
  const d = raw.replace(/\D/g, "").slice(0, 8);
  return d.length > 5 ? `${d.slice(0, 5)}-${d.slice(5)}` : d;
}

export function AddCustomerDialog({
  open,
  onOpenChange,
  phone,
  name: initialName,
  consultantId,
  onAdded,
}: AddCustomerDialogProps) {
  const { toast } = useToast();
  const [saving, setSaving] = useState(false);
  const [loadingCep, setLoadingCep] = useState(false);

  const [form, setForm] = useState({
    cpf: "",
    data_nascimento: "",
    name: "",
    email: "",
    phone_whatsapp: "",
    cep: "",
    address_street: "",
    address_neighborhood: "",
    address_complement: "",
    address_city: "",
    address_state: "",
    address_number: "",
    numero_instalacao: "",
    media_consumo: "",
    desconto_cliente: "",
  });

  useEffect(() => {
    if (open) {
      // Extract a clean phone: remove leading 55 for display if present
      const cleanPhone = phone.replace(/\D/g, "");
      setForm({
        cpf: "",
        data_nascimento: "",
        name: initialName || "",
        email: "",
        phone_whatsapp: cleanPhone,
        cep: "",
        address_street: "",
        address_neighborhood: "",
        address_complement: "",
        address_city: "",
        address_state: "",
        address_number: "",
        numero_instalacao: "",
        media_consumo: "",
        desconto_cliente: "",
      });
    }
  }, [open, phone, initialName]);

  const update = (field: string, value: string) =>
    setForm((prev) => ({ ...prev, [field]: value }));

  const fetchCep = useCallback(async () => {
    const cep = form.cep.replace(/\D/g, "");
    if (cep.length !== 8) return;
    setLoadingCep(true);
    try {
      const res = await fetch(`https://viacep.com.br/ws/${cep}/json/`);
      const data = await res.json();
      if (!data.erro) {
        setForm((prev) => ({
          ...prev,
          address_street: data.logradouro || prev.address_street,
          address_neighborhood: data.bairro || prev.address_neighborhood,
          address_city: data.localidade || prev.address_city,
          address_state: data.uf || prev.address_state,
          address_complement: data.complemento || prev.address_complement,
        }));
        toast({ title: "📍 Endereço preenchido automaticamente!" });
      }
    } catch {
      // silent
    } finally {
      setLoadingCep(false);
    }
  }, [form.cep, toast]);

  const handleSave = async () => {
    setSaving(true);
    try {
      const rawPhone = toWhatsappCanonical(form.phone_whatsapp);
      if (!isValidBrNationalPhone(rawPhone) || rawPhone.length < 12 || rawPhone.length > 13) {
        toast({ title: "Telefone inválido", description: "Use DDD + celular (10 ou 11 dígitos).", variant: "destructive" });
        setSaving(false);
        return;
      }
      const insertData: TablesInsert<"customers"> = {
        phone_whatsapp: rawPhone,
        consultant_id: consultantId,
        ...(form.name && { name: form.name }),
        ...(form.cpf && { cpf: form.cpf.replace(/\D/g, "") }),
        ...(form.data_nascimento && { data_nascimento: form.data_nascimento }),
        ...(form.email && { email: form.email }),
        ...(form.cep && { cep: form.cep.replace(/\D/g, "") }),
        ...(form.address_street && { address_street: form.address_street }),
        ...(form.address_neighborhood && { address_neighborhood: form.address_neighborhood }),
        ...(form.address_complement && { address_complement: form.address_complement }),
        ...(form.address_city && { address_city: form.address_city }),
        ...(form.address_state && { address_state: form.address_state }),
        ...(form.address_number && { address_number: form.address_number }),
        ...(form.numero_instalacao && { numero_instalacao: form.numero_instalacao }),
        ...(form.media_consumo && { electricity_bill_value: parseFloat(form.media_consumo) }),
        ...(form.desconto_cliente && { media_consumo: parseFloat(form.desconto_cliente) }),
      };

      const { error } = await supabase.from("customers").insert(insertData);

      if (error) {
        if (error.code === "23505") {
          toast({ title: "Este contato já é um cliente" });
        } else {
          throw error;
        }
      } else {
        toast({ title: "✅ Cliente adicionado com sucesso!" });
      }
      onAdded();
      onOpenChange(false);
    } catch {
      toast({ title: "Erro ao adicionar cliente", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const SectionTitle = ({ icon: Icon, title }: { icon: React.ElementType; title: string }) => (
    <div className="flex items-center gap-2 col-span-2 mt-2 mb-1">
      <div className="h-6 w-6 rounded-md bg-primary/10 flex items-center justify-center">
        <Icon className="h-3 w-3 text-primary" />
      </div>
      <span className="text-[11px] font-semibold text-foreground uppercase tracking-wider">{title}</span>
      <div className="flex-1 h-px bg-border" />
    </div>
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto p-0">
        {/* Header */}
        <div className="bg-gradient-to-r from-primary/10 via-primary/5 to-transparent px-6 pt-6 pb-4 border-b border-border">
          <DialogHeader>
            <DialogTitle className="text-base font-bold">Adicionar Cliente</DialogTitle>
            <p className="text-[11px] text-muted-foreground">Todos os campos são opcionais. Preencha o que souber.</p>
          </DialogHeader>
        </div>

        <div className="px-6 pb-6 pt-2">
          <div className="grid grid-cols-2 gap-3">
            {/* Personal Info */}
            <SectionTitle icon={User} title="Dados Pessoais" />

            <div className="col-span-2">
              <Label className="text-[11px] text-muted-foreground">Nome Completo</Label>
              <Input
                value={form.name}
                onChange={(e) => update("name", e.target.value)}
                placeholder="Nome do cliente"
                className="h-9 text-xs mt-1 bg-secondary/30 border-border/50 focus:border-primary/50"
              />
            </div>

            <div>
              <Label className="text-[11px] text-muted-foreground">CPF</Label>
              <Input
                value={form.cpf}
                onChange={(e) => update("cpf", formatCpf(e.target.value))}
                placeholder="000.000.000-00"
                className="h-9 text-xs mt-1 bg-secondary/30 border-border/50 focus:border-primary/50"
              />
            </div>

            <div>
              <Label className="text-[11px] text-muted-foreground">Data de Nascimento</Label>
              <Input
                type="date"
                value={form.data_nascimento}
                onChange={(e) => update("data_nascimento", e.target.value)}
                className="h-9 text-xs mt-1 bg-secondary/30 border-border/50 focus:border-primary/50"
              />
            </div>

            <div>
              <Label className="text-[11px] text-muted-foreground">Email</Label>
              <Input
                type="email"
                value={form.email}
                onChange={(e) => update("email", e.target.value)}
                placeholder="email@exemplo.com"
                className="h-9 text-xs mt-1 bg-secondary/30 border-border/50 focus:border-primary/50"
              />
            </div>

            <div>
              <Label className="text-[11px] text-muted-foreground">Celular</Label>
              <Input
                value={formatPhone(form.phone_whatsapp)}
                onChange={(e) => update("phone_whatsapp", e.target.value.replace(/\D/g, ""))}
                placeholder="(11) 9 9999-9999"
                className="h-9 text-xs mt-1 bg-secondary/30 border-border/50 focus:border-primary/50"
              />
            </div>

            {/* Address */}
            <SectionTitle icon={MapPin} title="Endereço" />

            <div>
              <Label className="text-[11px] text-muted-foreground">CEP</Label>
              <div className="flex gap-1.5 mt-1">
                <Input
                  value={form.cep}
                  onChange={(e) => update("cep", formatCep(e.target.value))}
                  placeholder="00000-000"
                  className="h-9 text-xs flex-1 bg-secondary/30 border-border/50 focus:border-primary/50"
                  onBlur={fetchCep}
                  onKeyDown={(e) => e.key === "Enter" && fetchCep()}
                />
                <Button
                  size="icon"
                  variant="outline"
                  className="h-9 w-9 shrink-0 border-border/50"
                  onClick={fetchCep}
                  disabled={loadingCep}
                >
                  {loadingCep ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Search className="h-3.5 w-3.5" />}
                </Button>
              </div>
            </div>

            <div>
              <Label className="text-[11px] text-muted-foreground">Rua</Label>
              <Input
                value={form.address_street}
                onChange={(e) => update("address_street", e.target.value)}
                placeholder="Rua / Av."
                className="h-9 text-xs mt-1 bg-secondary/30 border-border/50 focus:border-primary/50"
              />
            </div>

            <div>
              <Label className="text-[11px] text-muted-foreground">Número</Label>
              <Input
                value={form.address_number}
                onChange={(e) => update("address_number", e.target.value)}
                placeholder="Nº"
                className="h-9 text-xs mt-1 bg-secondary/30 border-border/50 focus:border-primary/50"
              />
            </div>

            <div>
              <Label className="text-[11px] text-muted-foreground">Bairro</Label>
              <Input
                value={form.address_neighborhood}
                onChange={(e) => update("address_neighborhood", e.target.value)}
                placeholder="Bairro"
                className="h-9 text-xs mt-1 bg-secondary/30 border-border/50 focus:border-primary/50"
              />
            </div>

            <div>
              <Label className="text-[11px] text-muted-foreground">Complemento</Label>
              <Input
                value={form.address_complement}
                onChange={(e) => update("address_complement", e.target.value)}
                placeholder="Apto, Bloco..."
                className="h-9 text-xs mt-1 bg-secondary/30 border-border/50 focus:border-primary/50"
              />
            </div>

            <div>
              <Label className="text-[11px] text-muted-foreground">Cidade / UF</Label>
              <div className="flex gap-1.5 mt-1">
                <Input
                  value={form.address_city}
                  onChange={(e) => update("address_city", e.target.value)}
                  placeholder="Cidade"
                  className="h-9 text-xs flex-1 bg-secondary/30 border-border/50 focus:border-primary/50"
                />
                <Input
                  value={form.address_state}
                  onChange={(e) => update("address_state", e.target.value.toUpperCase())}
                  placeholder="UF"
                  className="h-9 text-xs w-16 bg-secondary/30 border-border/50 focus:border-primary/50"
                  maxLength={2}
                />
              </div>
            </div>

            {/* Energy */}
            <SectionTitle icon={Zap} title="Dados de Energia" />

            <div>
              <Label className="text-[11px] text-muted-foreground">Nº Instalação</Label>
              <Input
                value={form.numero_instalacao}
                onChange={(e) => update("numero_instalacao", e.target.value)}
                placeholder="Número da instalação"
                className="h-9 text-xs mt-1 bg-secondary/30 border-border/50 focus:border-primary/50"
              />
            </div>

            <div>
              <Label className="text-[11px] text-muted-foreground">Média de Consumo (R$)</Label>
              <Input
                type="number"
                step="0.01"
                value={form.media_consumo}
                onChange={(e) => update("media_consumo", e.target.value)}
                placeholder="0,00"
                className="h-9 text-xs mt-1 bg-secondary/30 border-border/50 focus:border-primary/50"
              />
            </div>

            <div>
              <Label className="text-[11px] text-muted-foreground">Desconto (%)</Label>
              <Input
                type="number"
                step="0.1"
                value={form.desconto_cliente}
                onChange={(e) => update("desconto_cliente", e.target.value)}
                placeholder="0"
                className="h-9 text-xs mt-1 bg-secondary/30 border-border/50 focus:border-primary/50"
              />
            </div>
          </div>

          {/* Actions */}
          <div className="flex justify-end gap-2 mt-5 pt-4 border-t border-border">
            <Button variant="outline" size="sm" className="h-9 text-xs px-4" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            <Button
              size="sm"
              className="h-9 text-xs px-5 gap-1.5 font-semibold shadow-lg shadow-primary/20"
              onClick={handleSave}
              disabled={saving}
            >
              {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
              Salvar Cliente
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
