// FlowTourOverlay — tour de 5 balões para o consultor que abre o editor
// pela primeira vez. Usa Dialog do shadcn (já instalado) com um cartão
// fixo no canto e ponteiro descritivo (sem positioning DOM real, para
// evitar fragilidade quando elementos não estão montados).
//
// Disparado automaticamente quando steps.length === 0 e a flag
// `flow-tour-seen` não está no localStorage. O consultor pode reabrir
// pelo botão no painel.

import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ArrowRight, ArrowLeft, Check, GraduationCap } from "lucide-react";

const STORAGE_KEY = "flow-tour-seen";

type Balao = {
  titulo: string;
  texto: string;
  destaque: string;
};

const ROTEIRO: Balao[] = [
  {
    titulo: "Oi, eu sou a Iris",
    texto: "Vou te acompanhar enquanto você monta esse fluxo. Te explico o que cada botão faz e aviso quando algo ficar solto.",
    destaque: "Painel à direita",
  },
  {
    titulo: "Lista de passos",
    texto: "Cada passo é uma mensagem do bot. Clique num passo para eu te contar tudo sobre ele: regras, próximo destino, problemas.",
    destaque: "Coluna do meio",
  },
  {
    titulo: "Adicionar passo",
    texto: "Use o botão tracejado no fim da lista pra criar um passo novo. Você pode escolher um modelo pronto também.",
    destaque: "Botão '+ Adicionar passo'",
  },
  {
    titulo: "Simular antes de publicar",
    texto: "O botão de play (▶) abre uma conversa de teste. Sempre simule antes de soltar pro WhatsApp.",
    destaque: "Topo da página",
  },
  {
    titulo: "Roteiro do fluxo",
    texto: "No alto do meu painel estão 6 etapas: Acolher, Qualificar, Confirmar, Encaminhar, Cobrir desvios e Publicar. Vamos checar uma por uma.",
    destaque: "Stepper do consultor",
  },
];

interface Props {
  open: boolean;
  onClose: () => void;
}

export default function FlowTourOverlay({ open, onClose }: Props) {
  const [idx, setIdx] = useState(0);

  useEffect(() => {
    if (open) setIdx(0);
  }, [open]);

  const balao = ROTEIRO[idx];
  const ultimo = idx === ROTEIRO.length - 1;

  const fechar = () => {
    if (typeof window !== "undefined") {
      window.localStorage.setItem(STORAGE_KEY, "1");
    }
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) fechar(); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <GraduationCap className="h-5 w-5 text-primary" />
            {balao.titulo}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">{balao.texto}</p>
          <p className="rounded-md border border-primary/20 bg-primary/5 px-2 py-1 text-[11px] text-primary">
            Olhe para: {balao.destaque}
          </p>
          <div className="flex items-center justify-center gap-1">
            {ROTEIRO.map((_, i) => (
              <span
                key={i}
                className={`h-1.5 w-1.5 rounded-full transition-all ${
                  i === idx ? "w-4 bg-primary" : i < idx ? "bg-primary/40" : "bg-border"
                }`}
              />
            ))}
          </div>
        </div>
        <div className="flex justify-between gap-2">
          <Button variant="ghost" size="sm" onClick={fechar}>
            Pular tour
          </Button>
          <div className="flex gap-2">
            {idx > 0 && (
              <Button variant="outline" size="sm" onClick={() => setIdx(idx - 1)}>
                <ArrowLeft className="mr-1 h-3 w-3" /> Voltar
              </Button>
            )}
            {ultimo ? (
              <Button size="sm" onClick={fechar}>
                Beleza, vamos lá <Check className="ml-1 h-3 w-3" />
              </Button>
            ) : (
              <Button size="sm" onClick={() => setIdx(idx + 1)}>
                Próximo <ArrowRight className="ml-1 h-3 w-3" />
              </Button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** Devolve `true` se o consultor ainda não viu o tour. SSR-safe. */
export function tourPendente(): boolean {
  if (typeof window === "undefined") return false;
  return window.localStorage.getItem(STORAGE_KEY) !== "1";
}
