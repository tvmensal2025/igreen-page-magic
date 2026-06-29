> ⚠️ **Histórico (até 28/06/2026).** Repo migrado para `tvmensal2025/igreen-page-magic`. Workers ativos aqui: `worker-portal-2`, `worker-igreen-sync`, `compress-worker`. Portal 1 (`worker-portal`) permanece em `tvmensal2025/viana-replica-vault`.

# 🔄 Plano de Integração - WhatsApp Bot Automação

## 📋 Objetivo

Integrar o sistema **whapi-connect-joy** (bot WhatsApp com automação de portal) ao projeto atual **viana-replica-vault** (CRM iGreen), substituindo o Whapi por Evolution API e unificando tudo em um único sistema.

---

## 🎯 Visão Geral da Integração

### Sistema Atual (viana-replica-vault)
- ✅ CRM completo com WhatsApp via Evolution API
- ✅ Gestão de clientes e conversas
- ✅ Kanban de negociações
- ✅ Templates de mensagens
- ✅ Agendamento de mensagens
- ✅ Dashboard administrativo

### Sistema a Integrar (whapi-connect-joy)
- ✅ Bot conversacional inteligente
- ✅ OCR automático (Gemini) para documentos
- ✅ Automação do portal iGreen (Playwright)
- ✅ Fluxo completo de cadastro
- ✅ Integração com CertoSign (assinatura digital)
- ❌ Usa Whapi (será substituído por Evolution API)

### Resultado Final
**Sistema unificado** com:
- CRM completo + Bot inteligente
- Evolution API (único gateway WhatsApp)
- Automação de cadastro no portal iGreen
- OCR de documentos
- Assinatura digital
- Tudo em um único projeto

---

## 🔍 Análise de Compatibilidade

### ✅ Compatível (Reutilizar)

| Componente | Origem | Ação |
|-----------|--------|------|
| **OCR Gemini** | whapi | Migrar módulos `_shared/ocr.ts` |
| **Validações** | whapi | Migrar `_shared/validators.ts` |
| **Helpers de conversa** | whapi | Migrar `_shared/conversation-helpers.ts` |
| **Worker VPS** | whapi | Adaptar `worker-portal/` |
| **Máquina de estados** | whapi | Integrar lógica ao CRM |
| **Schema do banco** | whapi | Adicionar campos faltantes |

### ⚠️ Conflito (Adaptar)

| Componente | Problema | Solução |
|-----------|----------|---------|
| **Whapi API** | Usa Whapi, não Evolution | Criar adapter para Evolution API |
| **Tabela customers** | Schemas diferentes | Merge de campos |
| **Edge Functions** | Duplicação de funções | Unificar em funções existentes |
| **Frontend** | Dois dashboards | Integrar componentes |

### ❌ Remover

| Componente | Motivo |
|-----------|--------|
| **whapi-connect-joy/.git** | Histórico não necessário |
| **whapi-connect-joy/_archive** | Documentação antiga |
| **Configurações Whapi** | Será substituído por Evolution |

---

## 📊 Mapeamento de Tabelas

### Tabela `customers` - Merge de Campos

#### Campos Existentes (viana-replica-vault)
```sql
-- Campos básicos já existem
id, phone_whatsapp, name, cpf, email, created_at, updated_at
consultant_id, registered_by_name, customer_referred_by_name
```

#### Campos a Adicionar (de whapi-connect-joy)
```sql
-- Dados pessoais
rg text,
data_nascimento text,
phone_landline varchar,
nome_mae text,
nome_pai text,

-- Endereço
cep text,
address_street text,
address_number text,
address_complement text,
address_neighborhood text,
address_city text,
address_state text,

-- Conta de energia
distribuidora varchar,
numero_instalacao varchar,
electricity_bill_value numeric,
electricity_bill_photo_url text,
media_consumo numeric,

-- Documentos
document_type text, -- "RG (Novo)", "RG (Antigo)", "CNH"
document_front_url text,
document_back_url text,

-- Automação
status text NOT NULL DEFAULT 'pending',
conversation_step text,
otp_code text,
otp_received_at timestamptz,
link_assinatura text,
igreen_link text,
igreen_code text,
error_message text,
portal_submitted_at timestamptz,
ocr_confianca integer,

-- Flags
possui_procurador boolean DEFAULT false,
conta_pdf_protegida boolean DEFAULT false,
debitos_aberto boolean DEFAULT false,
senha_pdf varchar,

-- iGreen
andamento_igreen text,
devolutiva text,
data_cadastro text,
data_ativo text,
data_validado text,
status_financeiro text,
assinatura_cliente text,
assinatura_igreen text
```

### Tabela `conversations` - Já Existe
✅ Compatível, apenas adicionar campo `conversation_step` se não existir

---

## 🏗️ Arquitetura da Integração

```
┌─────────────────────────────────────────────────────────────┐
│                    FRONTEND UNIFICADO                        │
│  - Dashboard CRM (existente)                                 │
│  - Painel de Automação (novo)                                │
│  - Chat Teste (integrado)                                    │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                   SUPABASE EDGE FUNCTIONS                    │
│  ┌──────────────────┐  ┌──────────────────┐                 │
│  │ evolution-webhook│  │ whatsapp-bot     │ (novo)          │
│  │ (existente)      │  │ (adaptado)       │                 │
│  └──────────────────┘  └──────────────────┘                 │
│  ┌──────────────────┐  ┌──────────────────┐                 │
│  │ worker-callback  │  │ submit-otp       │ (novos)         │
│  └──────────────────┘  └──────────────────┘                 │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                    EVOLUTION API                             │
│  - Gerenciamento de instâncias                               │
│  - Envio/recebimento de mensagens                            │
│  - Webhooks                                                  │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                    WORKER VPS (Playwright)                   │
│  - Automação do portal iGreen                                │
│  - Upload de documentos                                      │
│  - Captura de OTP                                            │
│  - Link de assinatura                                        │
└─────────────────────────────────────────────────────────────┘
```

---

## 📝 Plano de Execução (Fases)

### FASE 1: Preparação e Análise ✅
- [x] Clonar repositório whapi-connect-joy
- [x] Analisar estrutura e dependências
- [x] Mapear tabelas e campos
- [x] Identificar conflitos
- [x] Criar plano de integração

### FASE 2: Migração do Schema do Banco
**Objetivo:** Adicionar campos necessários sem quebrar o existente

**Tarefas:**
1. Criar migration para adicionar campos à tabela `customers`
2. Adicionar índices necessários
3. Atualizar RLS policies se necessário
4. Testar migration em ambiente de desenvolvimento

**Arquivos:**
- `supabase/migrations/YYYYMMDDHHMMSS_add_automation_fields.sql`

### FASE 3: Migração de Módulos Compartilhados
**Objetivo:** Trazer lógica de OCR, validações e helpers

**Tarefas:**
1. Criar pasta `src/services/automation/`
2. Migrar e adaptar:
   - `ocr.ts` (OCR Gemini)
   - `validators.ts` (validações)
   - `conversation-helpers.ts` (máquina de estados)
   - `utils.ts` (utilitários)
3. Criar adapter para Evolution API (substituir Whapi)
4. Testes unitários dos módulos

**Arquivos:**
- `src/services/automation/ocr.ts`
- `src/services/automation/validators.ts`
- `src/services/automation/conversation.ts`
- `src/services/automation/evolution-adapter.ts`

### FASE 4: Edge Functions
**Objetivo:** Criar/adaptar Edge Functions para automação

**Tarefas:**
1. Criar `whatsapp-bot` (adaptado de `whatsapp-webhook`)
   - Usar Evolution API ao invés de Whapi
   - Integrar máquina de estados
   - Integrar OCR
2. Criar `worker-callback` (recebe callbacks do worker VPS)
3. Criar `submit-otp` (envia OTP ao worker)
4. Atualizar `evolution-webhook` para integrar com bot

**Arquivos:**
- `supabase/functions/whatsapp-bot/index.ts`
- `supabase/functions/worker-callback/index.ts`
- `supabase/functions/submit-otp/index.ts`

### FASE 5: Worker VPS (Playwright)
**Objetivo:** Adaptar worker para funcionar com Evolution API

**Tarefas:**
1. Copiar `worker-portal/` para o projeto
2. Adaptar configurações
3. Atualizar URLs e endpoints
4. Testar automação localmente
5. Deploy no EasyPanel/Hostinger

**Arquivos:**
- `worker-portal/server.mjs`
- `worker-portal/playwright-automation.mjs`
- `worker-portal/Dockerfile`

### FASE 6: Frontend - Painel de Automação
**Objetivo:** Criar interface para gerenciar automação

**Tarefas:**
1. Criar página `PortalAutomacao`
2. Componentes:
   - Status da fila
   - Logs de automação
   - Configurações do worker
   - Teste de OCR
3. Integrar com dashboard existente

**Arquivos:**
- `src/pages/PortalAutomacao.tsx`
- `src/components/automation/WorkerStatus.tsx`
- `src/components/automation/AutomationLogs.tsx`
- `src/components/automation/OCRTest.tsx`

### FASE 7: Integração com CRM
**Objetivo:** Unificar bot com CRM existente

**Tarefas:**
1. Atualizar `CustomerDetail` para mostrar dados de automação
2. Adicionar botão "Enviar ao Portal" no CRM
3. Mostrar status de automação no Kanban
4. Integrar conversas do bot com histórico do CRM

**Arquivos:**
- `src/components/whatsapp/CustomerDetail.tsx`
- `src/components/whatsapp/CustomerListItem.tsx`
- `src/hooks/useCustomers.ts`

### FASE 8: Testes e Validação
**Objetivo:** Garantir que tudo funciona

**Tarefas:**
1. Teste completo do fluxo:
   - Cliente envia mensagem
   - Bot responde
   - OCR extrai dados
   - Worker preenche portal
   - OTP e assinatura
2. Teste de edge cases
3. Teste de performance
4. Documentação de uso

### FASE 9: Deploy e Monitoramento
**Objetivo:** Colocar em produção

**Tarefas:**
1. Deploy das Edge Functions
2. Deploy do Worker VPS
3. Configurar variáveis de ambiente
4. Configurar webhooks da Evolution API
5. Monitoramento e logs
6. Documentação final

### FASE 10: Limpeza
**Objetivo:** Remover código desnecessário

**Tarefas:**
1. Remover pasta `whapi-analysis/`
2. Limpar imports não utilizados
3. Atualizar documentação
4. Commit final

---

## 🔐 Variáveis de Ambiente Necessárias

### Adicionar ao Supabase Edge Functions:
```bash
GEMINI_API_KEY=xxx                    # Google Gemini para OCR
WORKER_SECRET=xxx                     # Secret compartilhado com worker
IGREEN_CONSULTOR_ID=124170           # ID do consultor iGreen
MINIO_SERVER_URL=xxx                 # MinIO para documentos
MINIO_ROOT_USER=xxx
MINIO_ROOT_PASSWORD=xxx
MINIO_BUCKET=whatsapp-media
```

### Adicionar ao Worker VPS:
```bash
PORT=3100
NODE_ENV=production
HEADLESS=1
WORKER_SECRET=xxx
SUPABASE_URL=xxx
SUPABASE_SERVICE_ROLE_KEY=xxx
IGREEN_CONSULTOR_ID=124170
EVOLUTION_API_URL=xxx
EVOLUTION_API_KEY=xxx
```

---

## ⚠️ Pontos de Atenção

### 1. Não Quebrar o Existente
- ✅ Adicionar campos, não remover
- ✅ Manter compatibilidade com CRM atual
- ✅ Testes antes de cada deploy

### 2. Evolution API vs Whapi
- Criar adapter para abstrair diferenças
- Manter mesma interface de envio de mensagens
- Adaptar formato de webhooks

### 3. Performance
- Worker processa 1 lead por vez
- Timeout adequado para OCR (60s)
- Retry com backoff exponencial

### 4. Segurança
- Validar todos os inputs
- Sanitizar dados antes de enviar ao portal
- Proteger endpoints com autenticação
- Não expor secrets no frontend

### 5. Monitoramento
- Logs estruturados
- Métricas de sucesso/falha
- Alertas para erros críticos
- Dashboard de status

---

## 📊 Métricas de Sucesso

- ✅ Bot responde em < 5 segundos
- ✅ OCR com > 90% de precisão
- ✅ Automação do portal com > 95% de sucesso
- ✅ Tempo total de cadastro < 10 minutos
- ✅ Zero quebras no CRM existente

---

## 📚 Documentação a Criar

1. **GUIA_USO_AUTOMACAO.md** - Como usar o bot
2. **GUIA_OPERADOR_OTP.md** - Como lidar com OTP
3. **TROUBLESHOOTING_AUTOMACAO.md** - Solução de problemas
4. **API_EVOLUTION_ADAPTER.md** - Documentação do adapter

---

## 🎯 Próximos Passos Imediatos

1. ✅ Criar este plano de integração
2. ⏳ Revisar e aprovar o plano
3. ⏳ Iniciar FASE 2 (Migration do banco)
4. ⏳ Continuar sequencialmente pelas fases

---

**Status:** 📋 Plano criado, aguardando aprovação para iniciar execução

**Estimativa:** 3-5 dias de trabalho (dependendo da complexidade dos testes)
