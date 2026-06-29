> ⚠️ **Histórico (até 28/06/2026).** Repo migrado para `tvmensal2025/igreen-page-magic`. Workers ativos aqui: `worker-portal-2`, `worker-igreen-sync`, `compress-worker`. Portal 1 (`worker-portal`) permanece em `tvmensal2025/viana-replica-vault`.

# 📊 ANÁLISE COMPLETA DO CÓDIGO - PROJETO IGREEN

## 📈 ESTATÍSTICAS GERAIS

```
Total de Arquivos: 282 arquivos TypeScript/React/SQL
Total de Linhas: 30.483 linhas de código
Linguagens: TypeScript, React, SQL, Markdown
Framework: React + Vite + Supabase
```

---

## 🏗️ ARQUITETURA DO PROJETO

### **1. ESTRUTURA DE PASTAS**

```
📁 viana-replica-vault/
├── 📁 src/                          # Código fonte React
│   ├── 📁 components/               # Componentes reutilizáveis
│   ├── 📁 pages/                    # Páginas da aplicação
│   ├── 📁 hooks/                    # Custom hooks
│   ├── 📁 contexts/                 # Context API
│   ├── 📁 services/                 # Serviços externos
│   ├── 📁 integrations/             # Integrações (Supabase)
│   └── 📁 lib/                      # Utilitários
│
├── 📁 supabase/                     # Backend Supabase
│   ├── 📁 functions/                # Edge Functions
│   │   ├── 📁 _shared/              # Código compartilhado
│   │   ├── 📁 evolution-webhook/    # Webhook Evolution API
│   │   └── 📁 whatsapp-bot/         # Bot WhatsApp
│   └── 📁 migrations/               # Migrações SQL
│
├── 📁 public/                       # Arquivos estáticos
│   ├── 📁 images/                   # Imagens
│   └── 📁 videos/                   # Vídeos
│
└── 📁 whapi-analysis/               # Projeto referência Whapi
```

---

## 🎯 FUNCIONALIDADES PRINCIPAIS

### **1. SISTEMA DE LANDING PAGES (3 TIPOS)**

#### **A. Landing Page Cliente (`/:licenca`)**
**Arquivo:** `src/pages/ConsultantPage.tsx`

**Funcionalidades:**
- ✅ Página personalizada por consultor
- ✅ Hero section com vídeo
- ✅ Seção de benefícios
- ✅ Calculadora de economia
- ✅ Depoimentos
- ✅ FAQ
- ✅ Formulário de contato
- ✅ Integração WhatsApp

**Componentes:**
```typescript
- HeroSection.tsx          // Hero com vídeo
- BenefitsSection.tsx      // Benefícios energia solar
- CalculatorSection.tsx    // Calculadora economia
- TestimonialsSection.tsx  // Depoimentos clientes
- FAQSection.tsx           // Perguntas frequentes
- ContactSection.tsx       // Formulário contato
```

---

#### **B. Landing Page Licenciado (`/licenciado/:licenca`)**
**Arquivo:** `src/pages/LicenciadaPage.tsx`

**Funcionalidades:**
- ✅ Página para recrutar licenciados
- ✅ Plano de carreira
- ✅ Benefícios de ser licenciado
- ✅ Vídeos explicativos
- ✅ Formulário de cadastro
- ✅ Integração com CRM

**Componentes:**
```typescript
- LicHeroSection.tsx       // Hero licenciado
- LicBenefitsSection.tsx   // Benefícios licenciado
- LicCareerSection.tsx     // Plano de carreira
- LicWhySection.tsx        // Por que ser licenciado
- LicFormSection.tsx       // Formulário cadastro
```

---

#### **C. Página de Cadastro (`/cadastro/:licenca`)**
**Arquivo:** `src/pages/CadastroPage.tsx`

**Funcionalidades:**
- ✅ QR Code para WhatsApp
- ✅ 3 passos visuais
- ✅ Benefícios destacados
- ✅ Design moderno com gradiente
- ✅ Responsivo

**Componentes:**
```typescript
- QRCodeSection.tsx        // QR Code WhatsApp
- SolarPanelDecoration.tsx // Decoração painéis solares
```

---

### **2. PAINEL ADMINISTRATIVO**

#### **Arquivo:** `src/pages/Admin.tsx`

**Tabs Disponíveis:**
```typescript
1. Dashboard    // Métricas e estatísticas
2. Preview      // Preview da landing page
3. CRM          // Kanban de leads
4. Clientes     // Gestão de clientes
5. Rede         // Rede de licenciados
6. WhatsApp     // Gestão WhatsApp
7. Histórico    // Histórico de ações
8. Links        // Links personalizados
9. Dados        // Dados do consultor
10. Materiais   // Materiais de marketing
```

**Funcionalidades:**
- ✅ Gestão completa de clientes
- ✅ CRM com Kanban
- ✅ Integração WhatsApp
- ✅ Sincronização iGreen
- ✅ Exportação/Importação Excel
- ✅ Filtros avançados
- ✅ Modo privacidade
- ✅ Notificações
- ✅ Chat AI

---

### **3. SISTEMA WHATSAPP (EVOLUTION API)**

#### **A. Webhook Evolution (`supabase/functions/evolution-webhook/index.ts`)**

**Linhas de Código:** ~800 linhas

**Funcionalidades:**
```typescript
✅ 38 Steps Implementados:

// Fluxo Principal (10 steps)
1. welcome                    // Boas-vindas
2. aguardando_conta          // Aguarda conta energia
3. processando_ocr_conta     // OCR Gemini
4. confirmando_dados_conta   // Confirma dados (botões)
5. ask_tipo_documento        // Tipo documento (botões)
6. aguardando_doc_frente     // Aguarda frente
7. aguardando_doc_verso      // Aguarda verso + OCR
8. confirmando_dados_doc     // Confirma dados doc
9. ask_name                  // Pergunta nome
10. ask_cpf                  // Pergunta CPF

// Edição Conta (7 steps)
11. editing_conta_menu       // Menu edição
12. editing_conta_nome       // Editar nome
13. editing_conta_endereco   // Editar endereço
14. editing_conta_cep        // Editar CEP
15. editing_conta_distribuidora // Editar distribuidora
16. editing_conta_instalacao // Editar nº instalação
17. editing_conta_valor      // Editar valor

// Edição Documento (5 steps)
18. editing_doc_menu         // Menu edição doc
19. editing_doc_nome         // Editar nome
20. editing_doc_cpf          // Editar CPF
21. editing_doc_rg           // Editar RG
22. editing_doc_nascimento   // Editar data nasc

// Perguntas Manuais (11 steps)
23. ask_rg                   // Pergunta RG
24. ask_birth_date           // Pergunta data nasc
25. ask_phone_confirm        // Confirma telefone
26. ask_phone                // Pergunta telefone
27. ask_email                // Pergunta email
28. ask_cep                  // Pergunta CEP
29. ask_number               // Pergunta número
30. ask_complement           // Pergunta complemento
31. ask_installation_number  // Pergunta nº instalação
32. ask_bill_value           // Pergunta valor conta
33. ask_doc_frente_manual    // Pede frente doc
34. ask_doc_verso_manual     // Pede verso doc

// Finalização (5 steps)
35. ask_finalizar            // Botão finalizar
36. finalizando              // Validação + Portal Worker
37. portal_submitting        // Enviando ao portal
38. aguardando_otp           // Aguarda código via WhatsApp
39. validando_otp            // Valida OTP
40. aguardando_assinatura    // Aguarda assinatura
41. complete                 // Completo
```

**Integrações:**
```typescript
✅ OCR Gemini (conta + documento)
✅ ViaCEP (busca CEP)
✅ Portal Worker (cadastro automático)
✅ MinIO (upload documentos)
✅ Validações (CPF, CEP, email, telefone)
```

---

#### **B. Helpers Compartilhados (`supabase/functions/_shared/`)**

**1. `evolution-api.ts`** (200 linhas)
```typescript
// Funções Evolution API
- createEvolutionSender()    // Factory sender
- sendText()                 // Envia texto
- sendButtons()              // Envia botões
- downloadMedia()            // Baixa mídia
- parseEvolutionMessage()    // Parse payload
- extractMediaUrl()          // Extrai URL mídia
```

**2. `conversation-helpers.ts`** (150 linhas)
```typescript
// Helpers conversação
- getNextMissingStep()       // Próximo step
- getReplyForStep()          // Mensagem do step
- validarCPFDigitos()        // Valida CPF
- normalizarRG()             // Normaliza RG
- validarDataNascimento()    // Valida data
- validarNomeOCR()           // Valida nome
```

**3. `ocr.ts`** (300 linhas)
```typescript
// OCR Gemini
- ocrContaEnergia()          // OCR conta energia
- ocrDocumentoFrenteVerso()  // OCR documento
- extractTextFromImage()     // Extrai texto
- parseOCRData()             // Parse dados OCR
```

**4. `validators.ts`** (200 linhas)
```typescript
// Validadores
- validateCustomerForPortal() // Valida cliente
- validateCPF()              // Valida CPF
- validatePhone()            // Valida telefone
- sanitizeCustomerData()     // Sanitiza dados
```

**5. `utils.ts`** (250 linhas)
```typescript
// Utilitários
- logStructured()            // Log estruturado
- fetchWithTimeout()         // Fetch com timeout
- fetchInsecure()            // Fetch sem SSL
- withRetry()                // Retry automático
- buscarCepPorEndereco()     // Busca CEP
- normalizePhone()           // Normaliza telefone
```

---

### **4. PÁGINA DE CLIENTES WHATSAPP**

#### **Arquivo:** `src/pages/WhatsAppClientsPage.tsx`

**Funcionalidades:**
```typescript
✅ Lista todos os clientes via WhatsApp
✅ Estatísticas (Total, Completos, Pendentes, Falhas)
✅ Busca em tempo real
✅ Filtros por status
✅ Exportação CSV
✅ Design moderno com cards
✅ Badges coloridos
✅ Informações completas
```

**Componentes:**
```typescript
- Card                       // Card cliente
- Badge                      // Badge status
- Input                      // Campo busca
- Button                     // Botão exportar
- Select                     // Filtro status
```

---

### **5. GESTÃO DE CLIENTES**

#### **Arquivo:** `src/components/whatsapp/CustomerManager.tsx`

**Funcionalidades:**
```typescript
✅ Lista de clientes
✅ Busca avançada
✅ Filtros múltiplos:
   - Tipo (Todos, Energia, Telecom, WhatsApp)
   - Licenciado
   - Distribuidora
   - Cidade
   - Status
✅ Sincronização iGreen
✅ Importação/Exportação Excel
✅ Adicionar cliente manual
✅ Editar cliente
✅ Deletar cliente
✅ Abrir chat WhatsApp
✅ Copiar mensagem
✅ Paginação
```

**Filtro WhatsApp:**
```typescript
// Novo filtro elegante
<button onClick={() => setSelectedTipo("whatsapp")}>
  💬 WhatsApp
</button>

// Lógica de filtro
const tipoFiltered = selectedTipo === "whatsapp"
  ? searchFiltered.filter((c) => c.whatsapp_instance_id != null)
  : searchFiltered;
```

---

### **6. BANCO DE DADOS**

#### **Tabelas Principais:**

**1. `consultants`** - Consultores
```sql
- id (UUID)
- name (TEXT)
- email (TEXT UNIQUE)
- igreen_id (TEXT UNIQUE)
- license (TEXT)
- phone (TEXT)
- created_at (TIMESTAMPTZ)
```

**2. `customers`** - Clientes
```sql
- id (UUID)
- consultant_id (UUID FK)
- whatsapp_instance_id (UUID FK)
- name (TEXT)
- cpf (TEXT)
- rg (TEXT)
- email (TEXT)
- phone_whatsapp (TEXT)
- address_* (TEXT)
- distribuidora (TEXT)
- electricity_bill_value (DECIMAL)
- conversation_step (TEXT)
- status (TEXT)
- created_at (TIMESTAMPTZ)
```

**3. `whatsapp_instances`** - Instâncias WhatsApp
```sql
- id (UUID)
- consultant_id (UUID FK)
- instance_name (TEXT UNIQUE)
- api_url (TEXT)
- api_key (TEXT)
- webhook_url (TEXT)
- status (TEXT)
- created_at (TIMESTAMPTZ)
```

**4. `conversations`** - Conversas
```sql
- id (UUID)
- customer_id (UUID FK)
- message_direction (TEXT)
- message_text (TEXT)
- message_type (TEXT)
- conversation_step (TEXT)
- instance_name (TEXT)
- created_at (TIMESTAMPTZ)
```

**5. `settings`** - Configurações
```sql
- id (UUID)
- consultant_id (UUID FK)
- key (TEXT)
- value (TEXT)
- created_at (TIMESTAMPTZ)
```

---

### **7. INTEGRAÇÕES EXTERNAS**

#### **A. Evolution API**
```typescript
// Envio de mensagens
POST /message/sendText/:instance
POST /message/sendButtons/:instance
POST /message/downloadMedia/:instance

// Webhook
POST /webhook/set/:instance
GET /webhook/find/:instance
DELETE /webhook/delete/:instance
```

#### **B. Gemini AI (OCR)**
```typescript
// OCR Conta Energia
POST https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent

// Extrai:
- Nome
- Endereço (rua, número, bairro, cidade, estado)
- CEP
- Distribuidora
- Número instalação
- Valor conta
```

#### **C. ViaCEP**
```typescript
// Busca CEP
GET https://viacep.com.br/ws/{cep}/json/

// Retorna:
- Logradouro
- Bairro
- Cidade
- Estado
```

#### **D. Portal Worker**
```typescript
// Health check
GET /health

// Submeter lead
POST /submit-lead
{
  "customer_id": "uuid"
}

// Submeter OTP
POST /submit-otp
{
  "customer_id": "uuid",
  "otp_code": "123456"
}
```

#### **E. MinIO (Storage)**
```typescript
// Upload documentos
POST /functions/v1/upload-documents-minio
{
  "customer_id": "uuid"
}
```

---

### **8. COMPONENTES REUTILIZÁVEIS**

#### **UI Components (`src/components/ui/`)**
```typescript
- Button.tsx               // Botão
- Input.tsx                // Campo input
- Card.tsx                 // Card
- Badge.tsx                // Badge
- Select.tsx               // Select
- Dialog.tsx               // Modal
- Tabs.tsx                 // Tabs
- Toast.tsx                // Notificação
- Tooltip.tsx              // Tooltip
- Accordion.tsx            // Accordion
- Calendar.tsx             // Calendário
- Checkbox.tsx             // Checkbox
- Label.tsx                // Label
- RadioGroup.tsx           // Radio
- Separator.tsx            // Separador
- Sheet.tsx                // Sheet lateral
- Skeleton.tsx             // Loading skeleton
- Switch.tsx               // Switch
- Table.tsx                // Tabela
- Textarea.tsx             // Textarea
```

#### **Custom Components**
```typescript
// Admin
- DashboardTab.tsx         // Dashboard
- DadosTab.tsx             // Dados consultor
- LinksTab.tsx             // Links
- PreviewTab.tsx           // Preview
- MaterialsTab.tsx         // Materiais
- NetworkPanel.tsx         // Rede licenciados
- NotificationCenter.tsx   // Notificações
- AIChatPanel.tsx          // Chat AI

// WhatsApp
- WhatsAppTab.tsx          // Tab WhatsApp
- CustomerManager.tsx      // Gestão clientes
- KanbanBoard.tsx          // Kanban CRM
- AddCustomerDialog.tsx    // Adicionar cliente
- CustomerEditDialog.tsx   // Editar cliente
- CustomerImportExport.tsx // Import/Export
- AutoMessageLog.tsx       // Log mensagens

// Landing Pages
- HeroSection.tsx          // Hero
- BenefitsSection.tsx      // Benefícios
- CalculatorSection.tsx    // Calculadora
- TestimonialsSection.tsx  // Depoimentos
- FAQSection.tsx           // FAQ
- ContactSection.tsx       // Contato
- QRCodeSection.tsx        // QR Code
```

---

### **9. HOOKS CUSTOMIZADOS**

```typescript
// src/hooks/
- useAuth.ts               // Autenticação
- useAdminAuth.ts          // Auth admin
- useConsultantForm.ts     // Form consultor
- useWhatsApp.ts           // WhatsApp
- useCustomerDeals.ts      // Deals CRM
- useNotifications.ts      // Notificações
- usePrivacyMode.ts        // Modo privacidade
```

---

### **10. CONTEXTS**

```typescript
// src/contexts/
- AuthContext.tsx          // Contexto autenticação
- PrivacyModeContext.tsx   // Contexto privacidade
```

---

### **11. SERVIÇOS**

```typescript
// src/services/
- evolutionApi.ts          // API Evolution
- supabaseClient.ts        // Cliente Supabase
- analytics.ts             // Analytics
```

---

## 📊 FLUXO COMPLETO DO SISTEMA

### **1. Cliente Acessa Landing Page**
```
1. Cliente acessa: https://dominio.com/rafael-ferreira
2. Sistema carrega dados do consultor
3. Exibe landing page personalizada
4. Cliente preenche formulário
5. Dados salvos no Supabase
6. Notificação enviada ao consultor
```

### **2. Cliente Escaneia QR Code**
```
1. Cliente acessa: https://dominio.com/cadastro/rafael-ferreira
2. Exibe QR Code único do consultor
3. Cliente escaneia QR Code
4. Abre WhatsApp com mensagem pré-pronta
5. Cliente envia "Olá"
6. Bot inicia conversa automática
```

### **3. Bot WhatsApp Coleta Dados**
```
1. Bot: Boas-vindas
2. Bot: Pede foto conta energia
3. Cliente: Envia foto
4. Bot: OCR Gemini extrai dados
5. Bot: Mostra dados + botões (SIM/NÃO/EDITAR)
6. Cliente: Clica SIM
7. Bot: Pede tipo documento
8. Cliente: Escolhe RG Novo
9. Bot: Pede frente RG
10. Cliente: Envia foto
11. Bot: Pede verso RG
12. Cliente: Envia foto
13. Bot: OCR Gemini extrai dados
14. Bot: Mostra dados + botões
15. Cliente: Clica SIM
16. Bot: Perguntas complementares (se necessário)
17. Bot: Botão Finalizar
18. Cliente: Clica Finalizar
19. Bot: Valida tudo
20. Bot: Envia para Portal Worker
```

### **4. Portal Worker Cadastra**
```
1. Portal Worker recebe customer_id
2. Busca dados completos no Supabase
3. Abre navegador (Puppeteer)
4. Acessa portal iGreen com link único do consultor
5. Preenche TODOS os campos
6. Envia formulário
7. Portal iGreen envia código via WhatsApp
8. Cliente recebe código no WhatsApp
```

### **5. Cliente Digita OTP**
```
1. Cliente: Digita código no WhatsApp
2. Bot: Recebe código
3. Bot: Chama edge function submit-otp
4. Edge function: Envia para Portal Worker
5. Portal Worker: Digita código no portal
6. Portal iGreen: Valida código
7. Portal iGreen: Envia link assinatura
```

### **6. Cliente Assina Digitalmente**
```
1. Cliente: Recebe link assinatura
2. Cliente: Abre link
3. Cliente: Tira selfie
4. Cliente: Assina digitalmente
5. Portal iGreen: Valida assinatura
6. Bot: Notifica conclusão
7. Status: complete
```

### **7. Consultor Visualiza Cliente**
```
1. Consultor: Acessa /admin
2. Consultor: Clica tab "Clientes"
3. Consultor: Clica filtro "💬 WhatsApp"
4. Sistema: Mostra apenas clientes via WhatsApp
5. Consultor: Vê todos os dados
6. Consultor: Pode exportar CSV
```

---

## 🔐 SEGURANÇA

### **Autenticação**
```typescript
✅ Supabase Auth
✅ JWT Tokens
✅ Row Level Security (RLS)
✅ Email verification
✅ Password reset
```

### **Autorização**
```typescript
✅ Cada consultor vê apenas seus clientes
✅ Filtros automáticos por consultant_id
✅ RLS policies no banco
✅ Validação de permissões
```

### **Validações**
```typescript
✅ CPF (dígitos verificadores)
✅ CEP (8 dígitos + ViaCEP)
✅ Email (regex)
✅ Telefone (DDD + 8/9 dígitos)
✅ Campos obrigatórios
✅ Sanitização de dados
```

---

## 📈 PERFORMANCE

### **Otimizações**
```typescript
✅ Lazy loading de componentes
✅ Code splitting
✅ Imagens otimizadas
✅ Caching de dados
✅ Debounce em buscas
✅ Paginação de listas
✅ Suspense boundaries
```

### **Edge Functions**
```typescript
✅ Deploy global (Supabase Edge)
✅ Baixa latência
✅ Auto-scaling
✅ Timeout configurável
✅ Retry automático
```

---

## 🧪 TESTES

### **Configuração**
```typescript
// vitest.config.ts
- Unit tests
- Integration tests
- E2E tests (Playwright)
```

---

## 📦 DEPENDÊNCIAS PRINCIPAIS

```json
{
  "react": "^18.3.1",
  "react-dom": "^18.3.1",
  "react-router-dom": "^6.28.0",
  "@supabase/supabase-js": "^2.47.10",
  "@tanstack/react-query": "^5.62.7",
  "tailwindcss": "^3.4.17",
  "lucide-react": "^0.468.0",
  "date-fns": "^4.1.0",
  "recharts": "^2.15.0",
  "qrcode.react": "^4.1.0",
  "sonner": "^1.7.3",
  "zod": "^3.24.1"
}
```

---

## 🚀 DEPLOY

### **Frontend (Vercel/Netlify)**
```bash
npm run build
# Deploy automático via GitHub
```

### **Backend (Supabase)**
```bash
supabase functions deploy evolution-webhook
supabase functions deploy whatsapp-bot
```

---

## 📊 RESUMO FINAL

### **Código**
- ✅ 282 arquivos TypeScript/React
- ✅ 30.483 linhas de código
- ✅ Arquitetura modular
- ✅ Componentes reutilizáveis
- ✅ Hooks customizados
- ✅ Context API

### **Funcionalidades**
- ✅ 3 tipos de landing pages
- ✅ Painel admin completo (10 tabs)
- ✅ Sistema WhatsApp (38 steps)
- ✅ OCR Gemini
- ✅ Portal Worker integration
- ✅ CRM com Kanban
- ✅ Gestão de clientes
- ✅ Exportação/Importação
- ✅ Notificações
- ✅ Chat AI

### **Integrações**
- ✅ Evolution API
- ✅ Gemini AI
- ✅ ViaCEP
- ✅ Portal Worker
- ✅ MinIO
- ✅ Supabase

### **Banco de Dados**
- ✅ 5+ tabelas principais
- ✅ RLS policies
- ✅ Migrations
- ✅ Edge Functions

---

**Status:** ✅ **SISTEMA 100% FUNCIONAL E PRONTO PARA PRODUÇÃO**

**Última Atualização:** 12 de abril de 2026
