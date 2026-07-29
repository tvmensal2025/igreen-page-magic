// CtwaConnectGuide
// ────────────────
// Mini-wizard de 4 passos explicando o conceito de Click-to-WhatsApp pra
// consultores novos. Aparece **só quando a pré-checagem não está OK** — assim
// não polui a UI de quem já está com tudo verde.
//
// Passos:
//   1. Conectar WhatsApp (Whapi ou canal do consultor) — bot responde leads.
//   2. Conta Meta da plataforma já cobre Página/pixel (consultor só cadastra o próprio número).
//   3. Cadastrar telefone na WABA com SMS (modal CTWA).
//   4. Checklist verde e publicar.

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
    title: "1. Conecte o WhatsApp",
    body: "Vá na aba WhatsApp do menu e deixe o canal online (Whapi AUTH ou seu número conectado). Assim o bot atende todo lead que vier do anúncio.",
    cta: { label: "Abrir aba WhatsApp", href: "?tab=whatsapp" },
  },
  {
    icon: Facebook,
    title: "2. Conta de anúncios da plataforma",
    body: "A Página, a conta de anúncios e o pixel oficiais já estão na plataforma. Você não precisa reconectar o Facebook da iGreen — só garantir o WhatsApp abaixo.",
    cta: { label: "Ver conexão", href: "#facebook-connect" },
  },
  {
    icon: Smartphone,
    title: "3. Cadastre SEU telefone na Meta (SMS)",
    body: "Em Anúncios, use “Cadastrar / validar na Meta (SMS)”. Digite o seu número, peça o SMS e confirme o código. Sem o phone_number_id da Meta a campanha não publica.",
    cta: {
      label: "Abrir números WhatsApp (Meta)",
      href: "https://business.facebook.com/wa/manage/phone-numbers/",
      external: true,
    },
  },
  {
    icon: Rocket,
    title: "4. Checklist e publicação",
    body: "Quando os itens estiverem verdes no card Antes de anunciar, o botão Publicar libera. Use as fotos/vídeos oficiais da galeria ou um template publicado.",
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
