// Política de Privacidade — exigência LGPD para o lançamento (Fase 3 auditoria).
import { Link } from "react-router-dom";

export default function PoliticaPrivacidade() {
  return (
    <main className="min-h-screen bg-background text-foreground py-12 px-4">
      <article className="max-w-3xl mx-auto prose prose-invert prose-sm sm:prose-base">
        <h1 className="text-3xl font-bold mb-2">Política de Privacidade</h1>
        <p className="text-sm text-muted-foreground">Última atualização: 21/05/2026</p>

        <h2 className="mt-8">1. Quem somos</h2>
        <p>Esta plataforma é operada por consultores autorizados da iGreen Energy, atuando como parceiros independentes na captação de clientes para o programa de energia limpa.</p>

        <h2>2. Quais dados coletamos</h2>
        <ul>
          <li>Dados de contato (nome, telefone, e-mail)</li>
          <li>Dados cadastrais (CPF, RG, endereço, CEP)</li>
          <li>Conta de energia (foto, valor, número de instalação, distribuidora)</li>
          <li>Cookies de navegação e identificadores de marketing (GA4, Meta Pixel)</li>
        </ul>

        <h2>3. Como usamos</h2>
        <p>Para processar sua adesão ao programa, manter contato durante o cadastro e enviar atualizações relevantes via WhatsApp. Não compartilhamos seus dados com terceiros fora do fluxo necessário à contratação.</p>

        <h2>4. Seus direitos (LGPD)</h2>
        <p>Você pode, a qualquer momento, solicitar acesso, correção, anonimização ou exclusão dos seus dados. Para sair da nossa comunicação no WhatsApp, basta enviar <strong>SAIR</strong> em qualquer conversa.</p>

        <h2>5. Segurança</h2>
        <p>Armazenamos dados em servidores com criptografia em trânsito e em repouso. Documentos e fotos ficam em storage privado com acesso restrito.</p>

        <h2>6. Contato</h2>
        <p>Dúvidas sobre privacidade? Fale com o consultor que te atendeu ou envie SAIR para encerrar o contato automático.</p>

        <p className="mt-10">
          <Link to="/" className="text-primary underline underline-offset-2 inline-flex items-center min-h-11 px-2 -ml-2">← Voltar</Link>
        </p>
      </article>
    </main>
  );
}
