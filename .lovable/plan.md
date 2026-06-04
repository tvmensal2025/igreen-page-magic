Primeiro: você está certo em cobrar. A frase “não vai bloquear” foi uma afirmação absoluta que eu não deveria ter feito. Com Evolution/Baileys, que usa sessão tipo WhatsApp Web e não a API oficial da Meta, nunca existe garantia técnica de “risco zero”. O plano novo precisa assumir isso e mudar a estratégia para máxima segurança.

# Análise profunda do ocorrido

## Evidência dos logs e banco

### 1. O evento real foi fatal 403
O log da `evolution-webhook` registrou:

```text
CONNECTION_UPDATE: instance=igreen-953f7e48509b, state=close, reason=403
Instância desconectou FATAL (reason=403). Marcando needs_reconnect + ativando recovery mode (14d).
```

No padrão Baileys, `403` é `forbidden`. Isso deve ser tratado como possível bloqueio/restrição, não como simples queda de conexão.

### 2. O banco já travou a instância
A instância ficou assim:

```text
instance_name: igreen-953f7e48509b
connected_phone: 5511946097469
status: needs_reconnect
recovery_mode_until: 2026-06-18 17:46:30 UTC
```

Ou seja: o backend detectou fatal e ativou recovery de 14 dias.

### 3. Existe risco no plano anterior
O plano anterior dizia para usar `evolution-instance-reconnect` com logout forçado + novo QR. Isso é perigoso após `403`.

Arquivo crítico:

```text
supabase/functions/evolution-instance-reconnect/index.ts
```

Problemas encontrados:

- Faz `DELETE /instance/logout/{instance}` por padrão.
- Depois chama `GET /instance/connect/{instance}`.
- Depois chama `clear_recovery_mode` automaticamente.
- Apaga alguns sinais de risco.

Isso é o oposto do comportamento conservador esperado após `403`. Em fatal 403, o sistema deve bloquear reconexão automática, não limpar recovery.

### 4. A UI ainda induz reconexão
Pontos encontrados:

- `ConnectionPanel.tsx`: ainda mostra `Reconectar chip` quando conectado e quando desconectado com instância.
- `WhatsAppTab.tsx`: barra amarela ainda mostra `Reconectar`.
- `ConnectionPanel.tsx`: QR expirado diz “Renovando QR Code...”, mas o comentário diz que não deve renovar automaticamente. Texto contraditório.
- `InstanceHealth.tsx`: permite `Encerrar modo recuperação`, que chama `clear_recovery_mode`. Isso pode destravar envios cedo demais se o usuário estiver em bloqueio real.
- `safeReset` em `useWhatsApp.ts` faz logout, delete e create novamente. Após 403 isso deve ser bloqueado.

### 5. Os botões do WhatsApp não são garantidos via Evolution/Baileys
Pela arquitetura atual:

- Super admin/Whapi: aparece como “Botões reais do WhatsApp ativados”.
- Evolution/Baileys: o código tem fallback para texto numerado.

Isso significa que, se o requisito é “tem que funcionar os botões”, a solução confiável não deve depender de Baileys. O caminho correto para botões reais é WhatsApp Business Platform / Cloud API ou um provedor oficial/compatível que use a API da Meta.

# Conclusão técnica

## O Plano A atual reduz risco, mas não atende “nunca pode ser bloqueado”
Evolution/Baileys não é API oficial da Meta. Ele depende de sessão Web. Portanto:

- Pode desconectar.
- Pode cair em 401/403/440.
- Pode sofrer restrição do WhatsApp.
- Não permite prometer “nunca bloqueia”.
- Não é a melhor base para botões interativos confiáveis.

## Para o requisito “não pode dar erro”, o plano precisa mudar
A meta correta deve ser:

1. Nunca tentar recuperar agressivamente um número em estado fatal.
2. Nunca limpar recovery automaticamente.
3. Nunca mostrar botão que pareça seguro quando não é.
4. Separar “conectar novo chip” de “reconectar mesmo número”.
5. Migrar botões críticos para canal oficial Meta/Cloud API ou Whapi oficial.
6. Evolution fica apenas como fallback/manual, não como base de automação agressiva.

# Novo plano recomendado: Plano B — Segurança máxima

## Fase 0 — Agora, enquanto aguarda análise do WhatsApp

### Ações operacionais
- Não reconectar o número bloqueado via QR.
- Não clicar em resetar/reconectar para esse número.
- Aguardar a análise oficial do WhatsApp pelo celular.
- Se o WhatsApp liberar, voltar com baixo volume e sem disparos automáticos por pelo menos 24h.
- Se for usar outro número, conectar como chip novo e iniciar warmup do zero.

### Ações no sistema
- Manter a instância `igreen-953f7e48509b` em `needs_reconnect` e recovery até revisão manual real.
- Não limpar `recovery_mode_until` automaticamente.
- Não apagar `disconnect_fatal` automaticamente.

## Fase 1 — Hard-lock para 403/401/440

### Objetivo
Quando o WhatsApp retorna fatal, o sistema deve parar tudo e impedir ações perigosas.

### Implementação
- Criar um estado de risco explícito para instância fatal:

```text
normal
needs_qr
manual_review_required
blocked_or_restricted
safe_to_replace_chip
```

- Para `statusReason=403`, marcar:

```text
status = needs_reconnect
manual_review_required = true
fatal_disconnect_reason = 403
recovery_mode_until = now() + 14 days
```

- Enquanto estiver nesse estado:
  - bloquear `Reconectar chip`;
  - bloquear `Resetar conexão`;
  - bloquear `Gerar novo QR` para o mesmo número;
  - bloquear `Encerrar modo recuperação` sem confirmação administrativa forte;
  - bloquear envios automáticos e manuais em massa;
  - permitir apenas “Desconectar / trocar chip”.

## Fase 2 — Remover reconexão agressiva

### Arquivo crítico
`supabase/functions/evolution-instance-reconnect/index.ts`

### Mudanças
- Renomear semanticamente a função ou alterar o contrato para não prometer “reconnect”.
- Remover logout forçado por padrão.
- Remover limpeza automática de recovery.
- Remover exclusão automática de sinais de risco.
- Antes de conectar, consultar o banco:
  - se houver `disconnect_fatal` ativo;
  - se `recovery_mode_until` estiver ativo;
  - se o último reason for `403`, `401`, `440`, `409` ou `0`.
- Se qualquer condição fatal existir, retornar erro seguro:

```json
{
  "error": "manual_review_required",
  "message": "Número com desconexão fatal. Não reconecte antes de revisar no app oficial do WhatsApp."
}
```

## Fase 3 — Reorganizar botões da UI

### Objetivo
O usuário não pode ter dúvida nem clicar em ação de risco achando que é segura.

### Nova matriz de botões

```text
Sem instância:
  [Conectar novo WhatsApp]

Conectado saudável:
  [Desconectar / trocar chip]
  [Pausar envios]
  Não mostrar “Reconectar chip”

Conectando com QR:
  [Cancelar e desconectar]
  [Gerar outro QR] somente manual, com cooldown visual

Desconectado comum, sem fatal:
  [Gerar QR novamente]
  [Desconectar / trocar chip]

Fatal 403/401/440:
  [Desconectar / trocar chip]
  [Ver instruções de revisão]
  Não mostrar “Reconectar”
  Não mostrar “Resetar”
  Não mostrar “Encerrar recovery” para consultor comum

Recovery manual:
  [Pausar continua ativo]
  [Encerrar recovery] somente se não houver fatal 403 ativo ou se admin liberar
```

### Textos obrigatórios
Substituir qualquer promessa por texto correto:

- Errado: “não bloqueia”.
- Correto: “reduz risco, mas não elimina risco”.
- Errado: “Reconectar chip”.
- Correto: “Gerar novo QR” quando não fatal.
- Correto em fatal: “Número em revisão/restrição. Não reconectar agora.”

## Fase 4 — Corrigir o recovery mode

### Problema atual
`clear_recovery_mode` pode ser chamado pelo consultor e expira sinais fatais.

### Mudança recomendada
Separar dois tipos de pausa:

1. `pause_sending_now`: pausa operacional, o consultor pode encerrar depois.
2. `fatal_recovery_lock`: trava pós-fatal, somente admin ou regra segura libera.

### Regra nova
- `clear_recovery_mode` não deve limpar `disconnect_fatal` 403.
- Para 403, criar uma função separada, por exemplo:

```text
admin_clear_fatal_lock(instance, reason_confirmed)
```

Essa função só deve liberar se:

- usuário é admin/super_admin;
- motivo da liberação foi registrado;
- status oficial no celular foi confirmado;
- opcionalmente passou um período mínimo de espera.

## Fase 5 — Tornar botões reais confiáveis

### Diagnóstico
Se “botões” significa botões interativos reais dentro do WhatsApp, Evolution/Baileys não deve ser tratado como garantia.

### Caminho seguro
Implementar envio por canal oficial:

- WhatsApp Cloud API da Meta; ou
- Whapi/fornecedor que entregue pela Cloud API oficial; ou
- manter Evolution apenas com fallback texto numerado.

### Arquitetura proposta

```text
Canal oficial Meta/Whapi:
  - botões reais
  - templates aprovados
  - webhooks oficiais
  - menor risco por sessão Web

Evolution/Baileys:
  - conversas manuais/inbox
  - fallback texto
  - sem promessa de botões reais
  - sem automação agressiva
```

### Regra de produto
- Se a etapa do fluxo depende de botão, enviar via canal oficial.
- Se estiver em Evolution, renderizar fallback seguro:

```text
1. Sim
2. Não
Responda com o número da opção.
```

E o parser deve aceitar:

```text
1, sim, quero, opção 1
2, não, nao, opção 2
```

## Fase 6 — Corrigir erros mascarados

### Problema encontrado
Alguns adaptadores capturam erro e não falham explicitamente. Exemplo: `sendText` em `supabase/functions/_shared/whatsapp-api.ts` faz `console.error`, mas não propaga erro.

### Mudança
- Envio falhou deve retornar falha real.
- Registrar `record_risk_signal` em falhas de envio reais.
- Nunca mostrar mensagem como enviada se a API retornou timeout/falha.
- Para UI manual, mostrar status:

```text
Enviando
Enviado
Falhou — tentar novamente
Bloqueado por modo segurança
```

## Fase 7 — Auditoria dos disparadores automáticos

Verificar e ajustar todos os pontos que enviam mensagem:

- `bulk-scheduler`
- `reactivation-send`
- `reactivation-cron`
- `send-scheduled-messages`
- `ai-agent-router`
- `evolution-webhook` respostas automáticas
- `manual-step-send`
- serviços frontend de envio manual

Regra obrigatória:

```text
Antes de enviar:
  check_send_quota
  check fatal lock
  check channel capability
  check conversation window/template rules

Depois de enviar:
  register_send somente se envio confirmado
  record_risk_signal se falhou
```

## Fase 8 — Plano de dados/migração

Adicionar/ajustar campos em `whatsapp_instances`:

```text
manual_review_required boolean
fatal_disconnect_reason integer
fatal_disconnect_at timestamptz
fatal_lock_until timestamptz
last_qr_requested_at timestamptz
last_user_action text
last_user_action_at timestamptz
```

Adicionar tabela de auditoria:

```text
whatsapp_instance_actions
  instance_name
  consultant_id
  action
  risk_level
  blocked
  reason
  metadata
```

Essa tabela permitirá responder exatamente:

- quem clicou;
- em qual botão;
- quando;
- qual chamada foi feita;
- se foi bloqueada;
- por qual motivo.

## Fase 9 — Testes obrigatórios antes de liberar

### Testes de backend
- `403` ativa fatal lock.
- `403` impede reconnect.
- `403` impede reset.
- `403` não permite limpar recovery por consultor.
- `disconnect/trocar chip` continua funcionando.
- `connect novo chip` inicia warmup D1.

### Testes de UI
- Não existe botão “Reconectar chip” em estado fatal.
- Só existe um caminho visual para conexão.
- Em fatal, a tela mostra instrução clara.
- Botão de trocar chip aparece mesmo desconectado.
- QR expirado não diz “renovando” se não estiver renovando.

### Testes de envio
- Mensagem falha não aparece como sucesso.
- Botões reais só aparecem em canal oficial.
- Evolution usa fallback texto quando não suporta botão.
- Recovery bloqueia bulk, agendamento e reativação.

# Plano de execução recomendado

## Etapa 1 — Contenção imediata
- Bloquear reconexão/reset em fatal 403.
- Remover `Reconectar chip` da UI em estados conectados/fatais.
- Ajustar texto de QR/recovery.
- Impedir `evolution-instance-reconnect` de limpar recovery.

## Etapa 2 — Segurança estrutural
- Criar campos/tabela de auditoria.
- Separar pausa operacional de fatal lock.
- Registrar todas as ações de conexão/desconexão.

## Etapa 3 — Botões confiáveis
- Definir canal oficial para botões reais.
- Onde não houver canal oficial, usar fallback numerado.
- Ajustar fluxo para parser aceitar respostas textuais.

## Etapa 4 — Validação pesada
- Rodar testes de Edge Functions.
- Verificar logs do webhook.
- Simular 403, 401, 440, timeout e connection closed.
- Só liberar quando os estados perigosos estiverem bloqueados.

# Recomendação final

Para cumprir “nunca pode ser bloqueado” no sentido mais próximo possível, a decisão correta é:

- Não usar Evolution/Baileys para automação crítica de número antigo/importante.
- Usar API oficial Meta/Cloud API ou Whapi oficial para botões e fluxos críticos.
- Manter Evolution apenas como canal auxiliar/manual e sempre com hard-lock em fatal.

O sistema pode ser muito mais seguro, mas não deve mais prometer risco zero em Evolution. A promessa correta é: se houver sinal fatal, o sistema para antes de piorar a situação.