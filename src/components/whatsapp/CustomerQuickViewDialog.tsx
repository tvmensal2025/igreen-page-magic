import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { User, Phone, Mail, MapPin, Zap, FileText, Calendar, Hash, Link as LinkIcon, Loader2 } from "lucide-react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";

interface CustomerQuickViewDialogProps {
  customerId: string | null;
  customerName?: string | null;
  phone?: string | null;
  onClose: () => void;
}

function Row({ icon: Icon, label, value }: { icon: React.ElementType; label: string; value: React.ReactNode }) {
  if (value === null || value === undefined || value === "") return null;
  return (
    <div className="flex items-start gap-2 py-1.5 border-b border-border/30 last:border-0">
      <Icon className="h-3.5 w-3.5 text-muted-foreground mt-0.5 shrink-0" />
      <div className="min-w-0 flex-1">
        <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</p>
        <p className="text-xs text-foreground break-words">{value}</p>
      </div>
    </div>
  );
}

export default function CustomerQuickViewDialog({ customerId, customerName, phone, onClose }: CustomerQuickViewDialogProps) {
  const [data, setData] = useState<any | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!customerId) { setData(null); return; }
    setLoading(true);
    supabase
      .from("customers")
      .select("id,name,phone_whatsapp,email,cpf,address_city,address_state,address_street,address_neighborhood,electricity_bill_value,distribuidora,numero_instalacao,status,andamento_igreen,devolutiva,observacao,igreen_code,data_cadastro,data_ativo,data_validado,link_assinatura,tipo_produto,customer_origin,registered_by_name,nivel_licenciado,pos_venda_stage,pos_venda_reason,conversation_step")
      .eq("id", customerId)
      .maybeSingle()
      .then(({ data }) => { setData(data); setLoading(false); });
  }, [customerId]);

  const open = !!customerId;
  const display = data || { name: customerName, phone_whatsapp: phone };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-sm font-bold flex items-center gap-2">
            <User className="h-4 w-4 text-primary" />
            {display?.name || "Cliente"}
          </DialogTitle>
          <DialogDescription className="text-[11px]">
            Visualização rápida — para editar, abra o cadastro completo
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="space-y-1 mt-2">
            <div className="flex gap-1.5 flex-wrap mb-2">
              {display?.status && (
                <Badge variant="secondary" className="text-[10px]">Status: {display.status}</Badge>
              )}
              {display?.customer_origin && (
                <Badge variant="outline" className="text-[10px]">{display.customer_origin}</Badge>
              )}
              {display?.tipo_produto && (
                <Badge variant="outline" className="text-[10px]">{display.tipo_produto}</Badge>
              )}
              {display?.pos_venda_stage && (
                <Badge variant="outline" className="text-[10px] bg-primary/10 text-primary">{display.pos_venda_stage}</Badge>
              )}
            </div>

            <Row icon={Phone} label="WhatsApp" value={display?.phone_whatsapp} />
            <Row icon={Mail} label="Email" value={display?.email} />
            <Row icon={Hash} label="CPF" value={display?.cpf} />
            <Row icon={Hash} label="Código iGreen" value={display?.igreen_code} />
            <Row icon={MapPin} label="Cidade/UF" value={display?.address_city ? `${display.address_city}${display.address_state ? "/" + display.address_state : ""}` : null} />
            <Row icon={Zap} label="Conta de luz" value={display?.electricity_bill_value ? `R$ ${Number(display.electricity_bill_value).toFixed(2)}` : null} />
            <Row icon={Zap} label="Distribuidora" value={display?.distribuidora} />
            <Row icon={Hash} label="Nº Instalação" value={display?.numero_instalacao} />
            <Row icon={FileText} label="Andamento iGreen" value={display?.andamento_igreen} />
            <Row icon={FileText} label="Devolutiva" value={display?.devolutiva} />
            <Row icon={FileText} label="Observação" value={display?.observacao} />
            <Row icon={FileText} label="Motivo (pós-venda)" value={display?.pos_venda_reason} />
            <Row icon={User} label="Cadastrado por" value={display?.registered_by_name} />
            <Row icon={Calendar} label="Data cadastro" value={display?.data_cadastro ? format(new Date(display.data_cadastro), "dd/MM/yyyy", { locale: ptBR }) : null} />
            <Row icon={Calendar} label="Data ativação" value={display?.data_ativo ? format(new Date(display.data_ativo), "dd/MM/yyyy", { locale: ptBR }) : null} />
            <Row icon={LinkIcon} label="Link assinatura" value={display?.link_assinatura} />
            <Row icon={FileText} label="Etapa do bot" value={display?.conversation_step} />
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
