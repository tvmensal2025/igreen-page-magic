# Auditoria do Cadastro iGreen — “o que pede × o que salvamos”

## Por que

A Gislaine chegou ao portal sem documento e sem conta porque o nosso worker tratava upload como best-effort e não confrontava cada campo do portal com a coluna do nosso banco. Antes de continuar mexendo no worker, precisamos de um mapa autoritativo:

- todos os campos que o portal pede em cada um dos 5 passos
- todos os anexos exigidos
- como o portal chama cada endpoint da `api-green-connection.igreenenergy.com.br`
- e, para cada coisa pedida, **em qual coluna nossa ela já está salva** (ou está faltando).

## O que já levantei (sessão Playwright atual)

Entrei em `https://green.igreenenergy.com.br/autoconexao/?id=124170` (sem login — só o id do consultor) com dados fictícios. Confirmado:

- **Landing** — plano (R$ 120 default) e duração (1 / 3 / 6 anos).
- **PASSO 1 — Documento pessoal**
  - Toggle “Único arquivo” × “Frente e Verso”
  - Upload do documento (PDF/JPG/PNG)
  - Form: CPF, NOME COMPLETO, DATA DE NASCIMENTO, ÓRGÃO EXPEDIDOR (opcional)
  - Aviso visível: *“Validação humana ativada — análise pode levar até 5 dias úteis”* quando o OCR do portal não bate.
- **PASSO 2 — Conta de energia (parcial)**
  - Upload da conta
  - Combobox “Selecione o estado”
  - … (resto ainda não percorrido — combobox radix exige interação específica)
- **PASSO 3, 4, 5** — não percorridos ainda (provável endereço, contato/OTP, contrato/facial).

## O que farei após aprovar este plano

### 1. Concluir o walk-through (Playwright, dados fictícios)
- Tratar combobox radix (clicar trigger + selecionar opção).
- Capturar **screenshot + JSON** de cada passo (`PASSO 1..5`), com `label`, `placeholder`, `type`, `required` de cada input.
- Capturar todos os requests para `api-green-connection.igreenenergy.com.br` (URL, método, payload, resposta) — sem clicar em “Cadastrar” final, só até a tela imediatamente anterior, conforme você pediu.
- Mapear validações inline (“Campo obrigatório”, máscara CPF, CEP, data, e-mail, telefone).

Saída: `/tmp/browser/igreen/walk3/` com `01..05_view.json`, `api.log`, `net.txt` + relatório consolidado em `/mnt/documents/igreen-portal-map.md`.

### 2. Mapear payload real do worker
Ler `worker-portal-2/portal2-api-client.mjs` e listar, por endpoint chamado (`/cliente`, `/upload`, `/otp`, `/confirm-otp`, etc.), exatamente quais chaves enviamos hoje e de onde vêm.

### 3. Mapear colunas no Supabase
Para cada campo do portal, encontrar a coluna correspondente em:
- `customers` (208 colunas — vou listar as relevantes: `cpf`, `nome`, `data_nascimento`, `rg`, `orgao_expedidor`, `email`, `celular`, `cep`, `numero`, `complemento`, `cidade`, `estado`, `valor_conta`, `concessionaria`, `numero_instalacao`, `doc_front_url`, `doc_back_url`, `energy_bill_url`, `portal2_idcliente`, `otp_code`, `portal_retry_count`, `last_otp_dispatch_error`, etc.)
- `portal2_audit_traces` (rastreio de cada tentativa de cadastro)
- `storage_migration_log` / MinIO (URLs físicas dos anexos)

### 4. Entregar matriz “Portal × Worker × Banco”
Tabela única com 4 colunas:

```text
Campo no Portal | Endpoint que envia | Chave no payload do worker | Coluna no Supabase | Status (OK / Faltando / Divergente)
```

Mais um bloco final listando:
- **Campos pedidos pelo portal que não temos salvos.**
- **Campos que salvamos mas o portal não usa.**
- **Anexos que o portal exige × confirmação real via `verifyUpload`.**
- **Eventos do OTP / facial e onde gravamos cada estado.**

### 5. Recomendações (somente texto, nenhuma alteração de código nesta etapa)
Lista priorizada do que precisa ser ajustado no worker / schema, para te aprovar antes de qualquer mudança.

## O que NÃO farei

- Não clicarei em “Cadastrar” final em nenhum momento.
- Não submeterei OCR/OTP/facial reais.
- Não alterarei código nem schema neste passo — esta etapa é puramente de levantamento e relatório.

## Entregáveis

1. `/mnt/documents/igreen-portal-map.md` — relatório com screenshots referenciados, lista de campos por passo, e a matriz Portal × Worker × Banco.
2. Resumo no chat com as 3–5 lacunas mais críticas encontradas, para você decidir o que corrigir primeiro.
