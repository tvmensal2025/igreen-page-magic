/**
 * Explica em linguagem simples a diferença entre
 * Cérebro inteligente × Criar campanha.
 */
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Brain, Plus, Check, HelpCircle } from "lucide-react";

interface Props {
  open: boolean;
  onClose: () => void;
  onOpenSmart?: () => void;
  onOpenWizard?: () => void;
}

export function AdsCreateHelpDialog({ open, onClose, onOpenSmart, onOpenWizard }: Props) {
  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="ads-central-2026 max-w-lg border-[hsl(var(--ads-border))]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-[hsl(var(--ads-emerald-2))]">
            <HelpCircle className="h-5 w-5 text-primary" />
            Qual botão eu uso?
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 text-sm">
          <p className="text-[13px] text-[hsl(var(--ads-muted))] leading-relaxed">
            Os dois criam anúncio no Facebook que abre o WhatsApp.
            A diferença é <strong className="text-[hsl(var(--ads-text))]">quanto você configura</strong> e
            se o sistema <strong className="text-[hsl(var(--ads-text))]">cuida sozinho</strong> do dinheiro.
          </p>

          <div className="rounded-xl border border-[hsl(var(--ads-emerald)/.35)] bg-[hsl(var(--ads-emerald)/.08)] p-3.5 space-y-2">
            <div className="flex items-center gap-2 font-semibold text-[hsl(var(--ads-emerald-2))]">
              <Brain className="h-4 w-4" />
              Cérebro inteligente
            </div>
            <p className="text-[12px] text-[hsl(var(--ads-text))] leading-relaxed">
              É o caminho <strong>rápido e recomendado</strong>. Já vem no jeito que
              mais barateou lead (cidade da sua sede, mensagem pronta, remarketing).
              Você só escolhe foto ou vídeo e pode mudar o título.
            </p>
            <ul className="space-y-1.5 text-[12px] text-[hsl(var(--ads-text))]">
              <li className="flex gap-2"><Check className="h-3.5 w-3.5 text-primary shrink-0 mt-0.5" /> Poucos cliques — não precisa montar cidade, DDD nem público</li>
              <li className="flex gap-2"><Check className="h-3.5 w-3.5 text-primary shrink-0 mt-0.5" /> Liga o Cérebro: sobe ~15% se o lead estiver barato, desce ~15% se estiver caro</li>
              <li className="flex gap-2"><Check className="h-3.5 w-3.5 text-primary shrink-0 mt-0.5" /> Você define o valor do dia e o teto máximo (ele não passa disso)</li>
              <li className="flex gap-2"><Check className="h-3.5 w-3.5 text-primary shrink-0 mt-0.5" /> Pausa se gastar sem conversa (protege sua carteira)</li>
              <li className="flex gap-2"><Check className="h-3.5 w-3.5 text-primary shrink-0 mt-0.5" /> Melhor para crescer com <strong>1 campanha forte</strong></li>
            </ul>
            {onOpenSmart && (
              <Button size="sm" className="mt-1 gap-1.5" onClick={() => { onClose(); onOpenSmart(); }}>
                <Brain className="h-3.5 w-3.5" /> Usar Cérebro inteligente
              </Button>
            )}
          </div>

          <div className="rounded-xl border border-[hsl(var(--ads-border))] bg-secondary/20 p-3.5 space-y-2">
            <div className="flex items-center gap-2 font-semibold text-[hsl(var(--ads-text))]">
              <Plus className="h-4 w-4 text-primary" />
              Criar campanha
            </div>
            <p className="text-[12px] text-[hsl(var(--ads-text))] leading-relaxed">
              É o caminho <strong>completo</strong>. Você monta tudo: cidade ou rua,
              textos, dias, foto/vídeo, se quer remarketing, etc.
            </p>
            <ul className="space-y-1.5 text-[12px] text-[hsl(var(--ads-muted))]">
              <li className="flex gap-2"><Check className="h-3.5 w-3.5 shrink-0 mt-0.5" /> Mais liberdade para testar outra cidade ou criativo</li>
              <li className="flex gap-2"><Check className="h-3.5 w-3.5 shrink-0 mt-0.5" /> Mais passos — você decide cada detalhe</li>
              <li className="flex gap-2"><Check className="h-3.5 w-3.5 shrink-0 mt-0.5" /> O Cérebro <strong>não</strong> liga sozinho nesta campanha</li>
            </ul>
            {onOpenWizard && (
              <Button size="sm" variant="outline" className="mt-1 gap-1.5" onClick={() => { onClose(); onOpenWizard(); }}>
                <Plus className="h-3.5 w-3.5" /> Abrir criação completa
              </Button>
            )}
          </div>

          <p className="text-[11px] text-[hsl(var(--ads-muted))] leading-relaxed border-t border-[hsl(var(--ads-border))] pt-3">
            <strong className="text-[hsl(var(--ads-text))]">Dica:</strong> em dúvida, use o
            {" "}Cérebro inteligente. Use Criar campanha só quando quiser algo diferente
            do padrão (outra cidade, outro ângulo, teste manual).
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
