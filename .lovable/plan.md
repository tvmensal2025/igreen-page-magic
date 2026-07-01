## Objetivo
Fechar as lacunas restantes da sincronização com o escritório iGreen — hoje trazemos clientes, rede, boletos, telecom, seguros, devolutivas, métricas e cashback (GREEN/TELECOM). Ainda faltam blocos inteiros do portal novo e enriquecimento de fichas.

## Lacunas identificadas
1. **Cashback Seguros**: `/cashback/resumo?origem=SEGUROS` retorna 400 (não existe). Precisamos descobrir o endpoint real de comissões de apólices (hoje só tem 3 tentativas às cegas).
2. **Telecom** — só puxamos o Kanban `/crm/telecom` e faturas. Falta: resumo por linha (`/telecom/linhas`), portabilidade, recargas, comissões mensais.
3. **Seguros** — só puxamos o Kanban de 5 apólices. Falta: sinistros, endosso, renovações próximas, comissão paga/pendente.
4. **Financeiro do consultor** — não puxamos extrato de comissões, saques, saldo disponível, notas fiscais emitidas.
5. **Rede / Onboarding** — trazemos `/network-map/data` mas não puxamos: histórico de qualificações, upgrades de licenciados, eventos de graduação, aniversariantes de licenças.
6. **Devolutivas** — trazemos 5, mas não trazemos o histórico resolvido nem o detalhe por lead (motivo em texto longo, anexos).
7. **Detalhamento de cliente (`/crm/green/{id}`)** — hoje enriquecemos 66/66 fichas mas os campos ricos (contrato assinado, data de ativação de injeção, histórico de kWh, número da UC, distribuidora ID) não estão sendo persistidos em `customers`.
8. **Rotinas de tarefas** — puxamos `diaria/semanal/mensal` mas não gravamos como tarefas acionáveis (aniversário, boleto vencendo, licença expirando) numa tabela consultável.
9. **Sem diagnóstico**: quando um endpoint falha (como o cashback SEGUROS), o erro só aparece no log do worker — a UI nunca informa. Sem observabilidade não sabemos o que está faltando.

## Plano em 4 fases

### Fase 1 — Descoberta segura (probe estendido)
- Ampliar `PROBE_ALLOWLIST` em `worker-igreen-sync/server.mjs` com candidatos:
  `/seguros/comissoes`, `/seguros/sinistros`, `/seguros/renovacoes`,
  `/telecom/linhas`, `/telecom/recargas`, `/telecom/comissoes`,
  `/financeiro/extrato`, `/financeiro/saques`, `/financeiro/saldo`,
  `/rede/qualificacoes`, `/rede/graduacoes`, `/rede/aniversariantes`,
  `/clientes-green/{id}/historico`, `/clientes-green/{id}/kwh`.
- Rodar 1x, salvar shape em `worker_phase_logs` para consulta.
- Nenhum código de negócio é escrito antes de sabermos qual endpoint responde 200.

### Fase 2 — Persistência dos novos blocos
Com base nos endpoints validados na Fase 1:
- Novas tabelas (schema aditivo): `igreen_telecom_linhas`, `igreen_seguros_comissoes`, `igreen_seguros_sinistros`, `igreen_financeiro_extrato`, `igreen_rede_qualificacoes`, `igreen_rotinas_tarefas` (unificada).
- Colunas novas em `customers` para os campos ricos do detalhe: `uc_numero`, `contrato_assinado_em`, `injecao_ativa_em`, `distribuidora_id`, `historico_kwh_jsonb`.
- Todas com RLS por consultor + `GRANT` explícitos.

### Fase 3 — Worker + edge function
- `worker-igreen-sync`: novas funções `fetchTelecomLinhas`, `fetchSegurosComissoes`, `fetchFinanceiro`, `fetchRedeQualificacoes`, `enrichCustomerRich`. Incluir todas no `/sync-all` com `only[]` opcional.
- `supabase/functions/sync-igreen-customers`: mapear os novos payloads para as tabelas da Fase 2. Um endpoint = uma função de persistência isolada, cada uma tolerante a falha (não derruba as outras).

### Fase 4 — UI + Diagnóstico
- Painel `CarteiraGreenPanel`: novas seções condicionadas a dados presentes (`FinanceiroCard`, `TelecomLinhasList`, `SegurosDetalhesCard`, `RedeQualificacoesCard`).
- Aba nova "Diagnóstico" no painel: lê `worker_phase_logs` e mostra em verde/vermelho quais endpoints responderam na última sync, com timestamp e amostra do shape. Assim qualquer novo bloco que a iGreen adicionar aparece imediatamente para decidirmos integrar.

## Ordem de execução
1. Fase 1 (probe) — sozinha, sem risco. Aguardar output antes de continuar.
2. Fase 2 (migration) — só depois de saber o shape real de cada endpoint.
3. Fase 3 (worker + edge) — depende do schema.
4. Fase 4 (UI) — depende dos dados populados.

## Riscos
- Endpoints da API nova podem exigir `?consultor_id=` ou headers extras — a Fase 1 vai revelar.
- `SESSION_TTL_MS` de 30min é suficiente para o probe (todos os endpoints numa sessão).
- Zero impacto no fluxo D / WhatsApp — trabalho isolado no worker `igreen-sync` e na aba Clientes.

## Observação sobre `.lovable/`
O diretório `.lovable/` está no seu `.gitignore` — o `plan.md` que este tool grava não vai persistir no próximo snapshot. Se quiser guardar o plano, me diga que removo a entrada.