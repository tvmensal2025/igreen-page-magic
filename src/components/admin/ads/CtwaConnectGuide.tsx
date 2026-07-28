// CtwaConnectGuide
// ────────────────
// Mini-wizard de 4 passos explicando o conceito de Click-to-WhatsApp pra
// consultores novos. Aparece **só quando a pré-checagem não está OK** — assim
// não polui a UI de quem já está com tudo verde.
//
// Passos:
//   1. Conectar bot (Evolution QR) — bot responde leads no WhatsApp.
//   2. Conectar Facebook — autoriza Página + conta de anúncios + pixel.
//   3. Vincular WhatsApp Business à Página no Meta Business Suite.
//   4. Confirmar número (auto-detect) e publicar campanha.

import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ChevronDown, ChevronUp, ExternalLink, MessageSquare, Facebook, Smartphone, Rocket } from "lucide-react";
import { useCtwaPreflight } from "@/hooks/useCtwaPreflight";

interface Props {
  consultantId: string | null;
}

const STEPS = [
  {
    icon: MessageSquare,
    title: "1. Conecte o bot no WhatsApp",
    body: "Vá na aba WhatsApp do menu e escaneie o QR Code. O bot vai atender automaticamente todo lead que mandar mensagem.",
    cta: { label: "Abrir aba WhatsApp", href: "?tab=whatsapp" },
  },
  {
    icon: Facebook,
    title: "2. Conecte sua conta do Facebook",
    body: "Autorize sua Página oficial, conta de anúncios e (opcional) o rastreamento do Facebook. Isso permite criar campanhas em seu nome.",
    cta: { label: "Conectar Facebook", href: "#facebook-connect" },
  },
  {
    icon: Smartphone,
    title: "3. Vincule WhatsApp Business à sua Página",
    body: "Pelo Meta Business Suite, abra WhatsApp → Configurações da Conta → vincule o número à mesma Página que você conectou aqui. Esse é o número que vai aparecer nos anúncios.",
    cta: {
      label: "Abrir Meta Business Suite",
      href: "https://business.facebook.com/wa/manage/phone-numbers/",
      external: true,
    },
  },
  {
    icon: Rocket,
    title: "4. Checklist e publicação",
    body: "Quando os 4 itens estiverem verdes no card Antes de anunciar, o botão Publicar libera. Pronto: anúncio que abre o WhatsApp, sem link wa.me.",
  },
];

export function CtwaConnectGuide({ consultantId }: Props) {
  const { ready, loading } = useCtwaPreflight(consultantId);
  const [open, setOpen] = useState(false);

  // Não polui a UI de quem já está pronto.
  if (loading || ready) return null;

  return (
    <Card className="p-3 border-2 border-warning/40 bg-warning/5">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between gap-2 text-left"
      >
        <div className="flex items-center gap-2">
          <Rocket className="w-4 h-4 text-warning" />
          <div className="text-sm font-bold">Como anunciar no WhatsApp em 4 passos</div>
        </div>
        {open ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
      </button>

      {open && (
        <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-3">
          {STEPS.map((s) => {
            const Icon = s.icon;
            return (
              <div key={s.title} className="rounded-lg border border-border/40 bg-card/40 p-3">
                <div className="flex items-center gap-2 mb-1.5">
                  <Icon className="w-4 h-4 text-primary" />
                  <div className="text-sm font-semibold">{s.title}</div>
                </div>
                <div className="text-xs text-muted-foreground">{s.body}</div>
                {s.cta && (
                  <div className="mt-2">
                    <Button asChild size="sm" variant="outline" className="h-7 gap-1.5 text-xs">
                      <a
                        href={s.cta.href}
                        target={s.cta.external ? "_blank" : undefined}
                        rel={s.cta.external ? "noopener noreferrer" : undefined}
                      >
                        {s.cta.label}
                        {s.cta.external && <ExternalLink className="w-3 h-3" />}
                      </a>
                    </Button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
}
