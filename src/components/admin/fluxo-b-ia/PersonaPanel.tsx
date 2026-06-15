import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/use-toast";
import { Loader2, Save, RotateCcw, Sparkles } from "lucide-react";

const DEFAULT_PERSONA = `Você é Camila, vendedora da iGreen Energy no WhatsApp. Atende em português brasileiro, com tom humano, leve e direto. Sem emojis em excesso, sem caps lock, sem "scripts" robóticos.

OBJETIVO PRINCIPAL
- Levar o cliente a enviar uma FOTO da conta de luz. É com a foto que conseguimos calcular a economia e gerar o cadastro.
- Você responde dúvidas usando o CONHECIMENTO fornecido em cada turno. Se não tiver resposta no conhecimento, seja honesta ("vou confirmar e te respondo") em vez de inventar.

COMO FUNCIONA A IGREEN (resumo curto)
- Energia mais barata e 100% limpa, sem obra, sem troca de fio, sem fidelidade.
- O cliente continua recebendo a mesma conta da distribuidora; só ganha um desconto que vem por fazer parte da nossa comunidade de energia renovável.
- Desconto típico de 10% a 20% sobre o valor da conta de luz, dependendo da região.

REGRAS DE CONDUÇÃO
1. Faça UMA pergunta por vez. Mensagens curtas (2-4 linhas).
2. Não peça CPF, RG, CEP, endereço nem dados pessoais por texto. A foto da conta entrega tudo isso via OCR.
3. Quando o cliente demonstrar interesse, peça a foto da conta de luz e adicione [PEDIR_FOTO_CONTA] como ÚLTIMA linha.
4. Se o cliente recusar, responda educadamente e adicione [HANDOFF].
5. Se o cliente enviar a foto da conta, agradeça e adicione [FINALIZAR_CADASTRO].
6. NÃO invente preços, prazos, taxas ou cidades. Se não souber, [HANDOFF].
7. Use o histórico para não repetir perguntas já feitas.

ESTILO
- Frases curtas. 1 emoji por mensagem (☀️ 💡 ✅) com moderação.
- Trate por "você". Use o primeiro nome do cliente quando souber.
- Não use markdown — vai direto pro WhatsApp.`;

export default function PersonaPanel() {
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [text, setText] = useState("");
  const [original, setOriginal] = useState("");

  useEffect(() => {
    (async () => {
      setLoading(true);
      const { data, error } = await supabase
        .from("app_settings")
        .select("fluxo_b_persona")
        .eq("id", "global")
        .maybeSingle();
      if (error) {
        toast({ title: "Erro carregando persona", description: error.message, variant: "destructive" });
      }
      const persona = (data as any)?.fluxo_b_persona || DEFAULT_PERSONA;
      setText(persona);
      setOriginal(persona);
      setLoading(false);
    })();
  }, [toast]);

  async function save() {
    setSaving(true);
    const { error } = await supabase
      .from("app_settings")
      .update({ fluxo_b_persona: text, updated_at: new Date().toISOString() })
      .eq("id", "global");
    setSaving(false);
    if (error) {
      toast({ title: "Erro salvando", description: error.message, variant: "destructive" });
      return;
    }
    setOriginal(text);
    toast({ title: "Persona salva", description: "A IA já passa a usar este texto no próximo turno." });
  }

  function restoreDefault() {
    setText(DEFAULT_PERSONA);
  }

  const dirty = text !== original;
  const chars = text.length;

  if (loading) return <div className="flex justify-center p-8"><Loader2 className="animate-spin" /></div>;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-4">
          <div>
            <CardTitle className="flex items-center gap-2"><Sparkles className="w-5 h-5 text-primary" />Persona da IA</CardTitle>
            <CardDescription>
              Instruções que a IA segue em todo turno. Mantenha os marcadores
              <code className="mx-1 px-1 bg-muted rounded text-xs">[PEDIR_FOTO_CONTA]</code>
              <code className="mx-1 px-1 bg-muted rounded text-xs">[FINALIZAR_CADASTRO]</code>
              <code className="mx-1 px-1 bg-muted rounded text-xs">[HANDOFF]</code>
              nas regras — eles disparam ações no backend.
            </CardDescription>
          </div>
          <div className="flex gap-2 shrink-0">
            <Button variant="ghost" size="sm" onClick={restoreDefault} disabled={saving}>
              <RotateCcw className="w-4 h-4 mr-1" />Padrão
            </Button>
            <Button onClick={save} disabled={!dirty || saving} size="sm">
              {saving ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Save className="w-4 h-4 mr-1" />}
              Salvar
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <Textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={28}
          className="font-mono text-xs leading-relaxed"
          spellCheck={false}
        />
        <div className="flex justify-between mt-2 text-xs text-muted-foreground">
          <span>{chars.toLocaleString()} caracteres</span>
          {dirty && <span className="text-orange-500">Alterações não salvas</span>}
        </div>
      </CardContent>
    </Card>
  );
}
