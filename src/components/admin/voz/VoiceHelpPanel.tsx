/**
 * Ajuda rápida do módulo Ligação · SMS (Velip).
 */
import { VozCampaignShell, VozSection } from "./VozCampaignShell";

export function VoiceHelpPanel() {
  return (
    <VozCampaignShell
      title="Ajuda — Ligação e SMS"
      subtitle="Resumo operacional do módulo isolado (não altera WhatsApp/bot)."
    >
      <VozSection title="O que este módulo faz">
        <ul className="list-disc pl-5 space-y-1.5 text-sm" style={{ color: "var(--pe-text)" }}>
          <li>Ligações PSTN via Velip com áudio gravado (MP3) ou voz sintetizada (TTS).</li>
          <li>SMS outbound (manual, fallback após “não atendeu”, e cadência automática se ligada).</li>
          <li>Bases de contatos reutilizáveis e lista Não Perturbe (DNC).</li>
          <li>Histórico e painel com custo/status das ligações.</li>
        </ul>
      </VozSection>

      <VozSection title="Fluxo de uma ligação">
        <ol className="list-decimal pl-5 space-y-1.5 text-sm" style={{ color: "var(--pe-text)" }}>
          <li>Grave ou digite o texto (TTS) em Nova ligação.</li>
          <li>Escolha destinatários (clientes, base ou telefones avulsos).</li>
          <li>Opcional: texto de SMS se ninguém atender.</li>
          <li>Campanhas entram na fila; o cron dispara a cada ~5 minutos (exceto “ligar teste”, imediato).</li>
          <li>A Velip devolve status no webhook → Histórico atualiza.</li>
        </ol>
      </VozSection>

      <VozSection title="SMS">
        <ul className="list-disc pl-5 space-y-1.5 text-sm" style={{ color: "var(--pe-text)" }}>
          <li>Aba SMS: envio manual em lote.</li>
          <li>Fallback: campo na campanha de ligação — só após esgotar tentativas em “não atendeu”.</li>
          <li>Cadência: estágios SMS_1 / SMS_2 (Central de Automações; default OFF).</li>
          <li>OTP do cadastro iGreen NÃO passa por aqui (API Portal).</li>
        </ul>
      </VozSection>

      <VozSection title="Segurança e boas práticas">
        <ul className="list-disc pl-5 space-y-1.5 text-sm" style={{ color: "var(--pe-text)" }}>
          <li>Use a lista Não Perturbe para quem pediu para não ser contactado.</li>
          <li>Automação em massa (cadência) só dispara com toggles ligados na Central.</li>
          <li>Saldo e gasto aparecem no banner Velip no topo desta aba.</li>
          <li>Templates de voz no chat WhatsApp (OGG) são outro sistema — aba Templates do WhatsApp.</li>
        </ul>
      </VozSection>
    </VozCampaignShell>
  );
}
