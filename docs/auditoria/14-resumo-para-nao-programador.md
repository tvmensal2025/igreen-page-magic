# 14 — Resumo para Não Programador

> Última atualização: 08/06/2026

---

## O que é este projeto?

O **iGreen Official Portal** é um sistema completo de vendas de energia solar por WhatsApp. Ele faz:

1. **Captura leads** — Página na internet onde pessoas interessadas deixam seus dados
2. **Conversa por WhatsApp** — Um robô (bot) conversa com os leads automaticamente
3. **Vende usando IA** — Inteligência artificial (Gemini do Google) ajuda a convencer o lead
4. **Gerencia clientes** — Painel CRM com Kanban para o consultor acompanhar
5. **Cria anúncios** — Integração com Facebook/Instagram para tráfego pago
6. **Cadastra no portal** — Robot preenche formulário da iGreen automaticamente
7. **Acompanha pós-venda** — Automação de acompanhamento após fechamento

---

## Estado Atual: Nota 7/10

O sistema **funciona** e tem muita coisa boa implementada. Os pontos fortes são a proteção contra ban do WhatsApp e a inteligência artificial. Os pontos fracos são organização do código e algumas brechas de segurança.

---

## O que está BOM (pode confiar)

| Funcionalidade | Status |
|---------------|--------|
| Proteção contra ban do WhatsApp | ⭐ Excelente |
| Robô conversa com leads | ✅ Funciona |
| IA responde inteligentemente | ✅ Funciona |
| CRM com Kanban | ✅ Funciona |
| Campanhas Facebook | ✅ Funciona |
| Cadastro automático no portal | ✅ Funciona (com retry) |
| Segurança do backend | ✅ Boa |
| Controle de custos | ✅ Implementado |

---

## O que precisa de ATENÇÃO (riscos)

| Problema | Gravidade | Em linguagem simples |
|----------|-----------|---------------------|
| Email do super admin hardcoded | 🔴 CRÍTICO | Se alguém hackear esse email específico, ganha acesso total |
| Webhooks sem proteção | 🔴 CRÍTICO | Alguém poderia enviar mensagens falsas para o sistema |
| Páginas de admin sem trava | 🟠 ALTO | A tela de admin aparece por 1 segundo antes de verificar se a pessoa está logada |
| Tabelas crescem sem limite | 🟠 ALTO | Com o tempo, o sistema fica mais lento se não limpar dados antigos |
| Código WhatsApp muito grande | 🟠 ALTO | Se precisar corrigir algo no WhatsApp, é difícil porque está tudo misturado |

---

## Custos Estimados (100 consultores)

| Item | Custo/mês |
|------|-----------|
| Supabase (banco + funções) | R$ 125-375 |
| IA (Gemini/Google) | R$ 250-750 |
| Servidores (MinIO + Evolution + Workers) | R$ 200-400 |
| Monitoramento | Grátis ou R$ 130 |
| **Total** | **R$ 575-1.650/mês** |

Os anúncios do Facebook são pagos pelo consultor (sistema de carteira prepaid).

---

## Riscos de Conversão (vendas)

| Etapa | Risco | O que pode perder venda |
|-------|-------|------------------------|
| Pessoa vê o anúncio → clica | NORMAL | Anúncio ruim = poucos cliques |
| Clica → preenche dados | MÉDIO | Pedir CPF cedo assusta |
| Preenche → WhatsApp | ALTO | Se bot demora, pessoa desiste |
| WhatsApp → cadastro completo | ALTO | Muitos passos = abandono |
| Cadastro → portal iGreen | MÉDIO | Se worker falha, atrasa |

---

## O que NÃO pode mexer sem cuidado

1. **Sistema anti-ban** — Se mexer errado, o número do WhatsApp é banido permanentemente
2. **Segurança entre funções** — Se mexer errado, dados de clientes podem vazar
3. **Banco de dados (migrations antigas)** — NUNCA alterar uma migration que já rodou
4. **Fluxo do bot principal** — Qualquer erro para o atendimento automático

---

## Plano de Melhoria (resumo das 9 fases)

| Fase | O que | Quando | Risco |
|------|-------|--------|-------|
| 1 | Limpeza e organização | Pode fazer agora | ZERO |
| 2 | Corrigir falhas críticas de segurança | Urgente | BAIXO |
| 3 | Melhorar proteções de acesso | Próxima semana | BAIXO |
| 4 | Melhorar WhatsApp e mensagens | 2 semanas | MÉDIO |
| 5 | Melhorar CRM e leads | 3 semanas | BAIXO |
| 6 | Otimizar IA e custos | 1 mês | BAIXO |
| 7 | Melhorar conversão (vendas) | 1-2 meses | BAIXO |
| 8 | Performance e escalabilidade | 2 meses | BAIXO |
| 9 | Testes finais | Antes de qualquer publicação | ZERO |

---

## Perguntas Frequentes

**P: O sistema pode parar de funcionar?**
R: Sim, se o Supabase (banco de dados na nuvem) cair. É o ponto único de falha. Mas Supabase tem 99.9% de uptime.

**P: Pode perder leads?**
R: Em teoria, se o webhook falhar E não houver retry. Na prática, o sistema tem várias camadas de retry.

**P: O WhatsApp pode ser banido?**
R: Sim, mas o sistema tem a melhor proteção possível (warmup, limites, horários, simulação de humano).

**P: A IA pode falar besteira?**
R: Pode, mas tem base de conhecimento (FAQ) e limites. A IA é guiada por prompts específicos de venda solar.

**P: Quanto custa escalar para 1000 consultores?**
R: Estimativa: R$ 5.000-15.000/mês. O custo principal seria IA (Gemini) e Supabase (banco).

**P: Posso trocar a IA do Google por outra?**
R: Sim, o sistema já tem suporte a OpenAI como fallback. Mudar o modelo padrão é uma mudança de configuração.

---

## Próximo Passo

Autorize a execução da **FASE 1** (limpeza e organização) — zero risco, zero mudança funcional.
