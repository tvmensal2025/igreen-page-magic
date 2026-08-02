## Objetivo

1. Tirar o "preview" (tela de relatório) que ficou no lugar do app.
2. Fechar o buraco real do que você quer fazer: apagar os consultores antigos para recriarem conta do zero (com nome de IA e identidade novos), **sem perder as informações antigas**.

## Situação verificada agora (dados reais)

Consultores hoje:

| Consultor | Email | Clientes | Leads captados | Vendas |
|---|---|---|---|---|
| Rafael Ferreira Dias (superadmin) | rafael.ids@icloud.com | 1116 | 95.648 | 4 |
| silviaclaudiaalmeida | silviaclaudiaalmeida@gmail.com | 16 | 16 | 0 |
| Abel Olympio | abelolympio@gmail.com | 5 | 5 | 0 |
| olimpiajanete15 | olimpiajanete15@gmail.com | 1 | 1 | 0 |
| Bruna Roberta | brunabwk@gmail.com | 0 | 0 | 0 |

**Problema encontrado (o buraco):** a função atual `admin-delete-consultant` apaga o usuário do `auth`, e as chaves estrangeiras do banco estão assim:

- `customers` → **SET NULL**: o cliente sobrevive, mas fica **órfão, sem dono** (some do painel de todo mundo).
- `captured_leads`, `sales`, `proposals`, `igreen_customer_boletos`, `igreen_telecom_customers`, `igreen_seguros_customers`, `igreen_consultant_metrics`, `rodizio_assignments`, `reactivation_*`, `ai_knowledge_sections` e ~40 outras tabelas → **CASCADE = apagadas para sempre**.

Ou seja: do jeito que está, excluir o consultor **não** preserva "os nomes e as informações de antes". Perde os 22 leads captados e os históricos de Silvia/Abel/Janete.

## O que eu proponho fazer

### 1. Tirar o preview
`src/main.tsx` volta a renderizar apenas `<App />` (sem tela estática nenhuma).

### 2. Nova função: "Resetar consultor" (recomendado, em vez de excluir)

Nova edge function `admin-reset-consultant` (só superadmin), que faz o consultor "começar do zero" **sem apagar nada**:

- Zera a identidade/IA: nome da assistente, avatar, textos personalizados, áudios, prefs de automação, cadence/theme config, knowledge sections, wizard de identidade → estado "não configurado", para ele refazer o onboarding completo.
- Desconecta a instância WhatsApp (Evolution) e limpa `needs_reconnect`, forçando novo QR.
- Mantém: clientes, leads captados, vendas, histórico, telefone, licença.
- Opcional por checkbox: forçar reset de senha (envia e-mail) ou marcar `approved = false` para ele passar de novo pela aprovação.

Resultado: ele "cria tudo de novo" na prática, com login preservado e nenhum dado perdido.

### 3. Excluir de verdade (quando for mesmo apagar)

Endurecer `admin-delete-consultant` para não destruir histórico:

- Antes de apagar, **transferir** para o superadmin Rafael: `customers.consultant_id`, `captured_leads`, `sales`, `proposals`, `igreen_*` e `rodizio_assignments`.
- Só depois apagar o usuário do `auth` (o cascade então não encontra nada de valor).
- Retornar um resumo do que foi transferido.
- Bloqueio explícito: nunca permitir excluir `rafael.ids@icloud.com` / o superadmin.

### 4. UI no painel do superadmin

Na lista de consultores, dois botões distintos:
- **Resetar (recomeçar do zero)** — abre confirmação explicando que os dados ficam.
- **Excluir** — confirmação em duas etapas mostrando "X clientes e Y leads serão transferidos para Rafael".

## Detalhes técnicos

- Edge functions com `is_super_admin` + service role, mesmo padrão da atual.
- Transferência feita em transação via RPC `SECURITY DEFINER` (`admin_transfer_consultant_assets(p_from uuid, p_to uuid)`), com `GRANT EXECUTE` só para `authenticated` e checagem interna de superadmin.
- Reset de identidade também via RPC, para uma única transação.
- Testes Deno para: bloqueio de não-superadmin, bloqueio de auto-exclusão, transferência antes do delete, e reset preservando contagens.

## O que fica fora (operação sua, não código)

- Reconectar as 4 instâncias Evolution.
- Limpar os 24 leads travados no modal (handoff/bot pausado).
- Validar o Grupo C na segunda 08:05.
