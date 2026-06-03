# Auditoria do Fluxo D — pronto para tráfego pago?

Vou validar o Fluxo D em **3 frentes**: configuração (já levantada), simulação ponta-a-ponta (botão por botão) e infraestrutura de alertas/recuperação. Sem alterar nada — só leitura, simulação e relatório.

## O que já confirmei (leitura do banco)

- **Fluxo D ativo:** `Fluxo Whapi (botões)` (`is_active=true`, variant=`D`, 14 passos ativos).
- **Welcome (d_welcome)** com 3 botões — todos com destino válido:
  - 💚 Quero simular → `d_escolher_simulacao`
  - 🤔 Como funciona → `d_como_funciona`
  - 👨‍💼 Falar com Rafael → handoff humano
- **Edge functions ativas:** `whapi-webhook`, `flow-d-health-cron`, `flow-d-stuck-watchdog`, `bot-stuck-recovery`, `evolution-proxy` — todas bootando sem erro nos últimos logs.

## Caminhos a percorrer (cada botão / cada ramo)

```text
d_welcome
 ├─ "Quero simular"  → d_escolher_simulacao
 │     ├─ "Simulação completa" → d_pedir_conta → d_resultado
 │     │     ├─ "Continuar Cadastro" → d_pedir_documento → d_pedir_email → d_confirmar_telefone → d_finalizar
 │     │     ├─ "Tenho dúvidas"      → d_duvidas (3 botões)
 │     │     └─ "Falar com Rafael"   → handoff
 │     └─ "Simulação rápida" → d_simular_valor → d_simular_resultado
 │            ├─ "Continuar Cadastro" → d_pedir_documento → ... → d_finalizar
 │            ├─ "Ainda tenho dúvida" → d_duvidas
 │            └─ "Como Funciona"     → d_como_funciona
 ├─ "Como funciona" → d_como_funciona
 │     ├─ "Continuar Cadastro" → d_pedir_conta
 │     ├─ "Ainda tenho dúvida" → d_duvidas
 │     └─ "Falar com Rafael"   → handoff
 └─ "Falar com Rafael" → handoff
```

## Plano de verificação

1. **Conferência estrutural (já parcial)**
   - Confirmar que todo `goto_step_id` aponta para passo ativo do mesmo flow.
   - Conferir botões de `d_duvidas`, `d_simular_resultado`, `d_escolher_simulacao` (alguns ainda truncados na leitura).
   - Validar capturas: `capture_conta`, `capture_documento` (auto-detect), `capture_email` (regex), `confirm_phone`.

2. **Simulação end-to-end via `whapi-webhook`**
   - Criar payloads de mensagens entrantes (texto + botão) simulando um lead real, disparando em sequência os ramos do diagrama.
   - Validar em `conversations` que cada step disparou a mensagem certa e que `customer_flow_state` avançou para o próximo `step_key`.
   - Confirmar que o OCR (conta + documento) está plugado e que `processando_ocr_conta` desbloqueia para `d_resultado`.

3. **Infra de segurança**
   - Conferir `flow-d-health-cron` (últimos `flow_d_health_runs` e `bot_handoff_alerts` tipo `flow_d_*`).
   - Conferir `bot-stuck-recovery` (lead travado em D recebe nudge).
   - Verificar `evolution-proxy` (instância WhatsApp respondendo).
   - Conferir se a campanha de Ads está apontando para o número/instância certa e se a label/UTM grava `flow_variant='D'`.

4. **Relatório final**
   - Tabela com cada ramo: **OK** / **quebrado** / **risco**.
   - Lista de correções (se houver) ordenada por impacto em conversão.
   - Sinal verde 🟢 / amarelo 🟡 / vermelho 🔴 para liberar tráfego.

## Fora de escopo

- Não vou alterar passos, botões, transições ou copy sem o seu OK.
- Não vou enviar mensagens reais para clientes — só payloads de teste contra o webhook.
- Não vou mexer em Ads Manager / Meta — só verifico se o link e o roteamento para Fluxo D estão corretos.

Confirma que posso rodar essa auditoria? Se quiser, posso focar só em um ramo específico (ex.: só o caminho do botão "Quero simular").