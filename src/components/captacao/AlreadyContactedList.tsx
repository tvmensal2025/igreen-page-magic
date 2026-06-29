// AlreadyContactedList
// ─────────────────────
// Mostra leads que já receberam mensagem em disparo anterior. Fica numa aba
// separada para não misturar com a lista de "novos".

import { useMemo, useState } from "react";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Search, Building2, User as UserIcon, Phone, CheckCircle2, MessageCircle,
} from "lucide-react";
import type { CapturedLead } from "@/services/capturedLeads";

const CHANNEL_LABEL: Record<string, string> = {
  meta_leadads: "Anúncio Facebook/Instagram",
  tiktok_leadgen: "Anúncio TikTok",
  ctwa: "Veio do anúncio",
  landing: "Site / Página",
  research: "Empresa pesquisada",
  manual: "Cadastro manual",
};

interface Props { leads: CapturedLead[] }

export function AlreadyContactedList({ leads }: Props) {
  const [search, setSearch] = useState("");

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return leads;
    return leads.filter((l) =>
      [l.full_name, l.company_name, l.phone, l.email]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(q)),
    );
  }, [leads, search]);

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="shrink-0 p-3 border-b border-border/60 space-y-2 bg-card/40 rounded-t-lg">
        <div className="flex items-center gap-2 text-sm">
          <MessageCircle className="w-4 h-4 text-success" />
          <span className="font-semibold">{leads.length}</span>
          <span className="text-muted-foreground">já conversados</span>
        </div>
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar conversado..."
            className="pl-8 h-9 text-sm bg-background"
          />
        </div>
        <p className="text-[11px] text-muted-foreground leading-snug">
          Estes leads já receberam mensagem sua. Ficam aqui para não repetir o disparo.
        </p>
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto rounded-b-lg border-x border-b border-border bg-card/30">
        {filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 py-16 text-center px-4">
            <MessageCircle className="w-10 h-10 text-muted-foreground/30" strokeWidth={1} />
            <p className="text-sm text-muted-foreground">
              {leads.length === 0
                ? "Ninguém aqui ainda. Quando você disparar para um lead, ele aparece nesta aba."
                : "Nenhum resultado para essa busca."}
            </p>
          </div>
        ) : (
          <ul className="divide-y divide-border/30">
            {filtered.map((l) => (
              <li key={l.id} className="p-3 hover:bg-muted/30 transition-colors">
                <div className="flex items-start gap-2">
                  {l.person_type === "pj"
                    ? <Building2 className="w-4 h-4 text-info shrink-0 mt-0.5" />
                    : <UserIcon className="w-4 h-4 text-primary shrink-0 mt-0.5" />}
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium truncate">
                      {l.company_name || l.full_name || "—"}
                    </div>
                    {l.phone && (
                      <div className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5">
                        <Phone className="w-3 h-3" />{l.phone}
                      </div>
                    )}
                    <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
                      <Badge variant="outline" className="text-[10px] gap-0.5 border-success/40 text-success bg-success/10 px-1.5 py-0">
                        <CheckCircle2 className="w-2.5 h-2.5" /> Enviado
                      </Badge>
                      <span className="text-[10px] text-muted-foreground truncate">
                        {CHANNEL_LABEL[l.channel] || l.channel}
                      </span>
                    </div>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
