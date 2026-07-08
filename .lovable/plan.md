## Diagnóstico do erro atual

O bloqueio mudou de “permissão ausente” para uma recusa direta da Meta ao criar o conjunto de anúncios:

- A conta da plataforma está usando a Página `106742552184431` (`Instituto dos Sonhos`).
- A conta de anúncios é `act_317035519061535` (`Rafael Ferreira`).
- O consultor afetado é `Rafael Ferreira`, com WhatsApp salvo `5534984314317`.
- No banco, esse consultor está sem `whatsapp_phone_number_id` real salvo; existe só o número.
- O resolvedor caiu no fallback `permission_limited:5534984314317` porque o token da plataforma ainda não permite listar/validar o telefone via WABA.
- A Meta recusou o número no `adsets` com subcode `1487246`: `This WhatsApp phone number is not linked to your account`.

Conclusão: o problema não é mais só código. A Meta está dizendo que o número `5534984314317` não está vinculado/permitido para a Página/conta de anúncios usada. Mesmo com fallback, a API oficial bloqueia.

## Plano de correção

1. Remover o fallback perigoso `permission_limited` do fluxo de criação de campanha
  - Não tentar publicar anúncio com número sem `phone_number_id` real.
  - Bloquear antes de criar campanha/adset órfãos na Meta.
  - Exibir mensagem objetiva: “faltou vincular WABA/phone_number_id real”.
2. Ajustar a validação automática
  - `facebook-auto-fix-whatsapp` deve retornar status bloqueado quando só existir número salvo sem ID real.
  - A resposta deve mostrar os links corretos da Meta e o que falta: vincular a WABA à Página ou salvar o `phone_number_id` numérico real.
3. Ajustar a UI em Admin → Dados
  - Manter o campo de `phone_number_id` obrigatório.
  - Se a validação voltar com `permission_limited`, não tratar como sucesso.
  - Mostrar os links diretos:
    - WhatsApp Manager: `https://business.facebook.com/wa/manage/phone-numbers/`
    - Contas WhatsApp Business: `https://business.facebook.com/settings/whatsapp-business-accounts`
    - Páginas: `https://business.facebook.com/settings/pages`
4. Melhorar a reconexão Meta da plataforma
  - Confirmar que o OAuth pede `whatsapp_business_management` com `auth_type=rerequest`.
  - Garantir retorno para `https://igreen.cloud`.
  - Após reconectar, orientar o usuário a selecionar os assets novamente se a Meta trocar Página/conta.
5. Opcional, se aprovado: criar uma checagem de diagnóstico mais clara
  - A função pode retornar separadamente:
    - token tem permissão WhatsApp?
    - Página expõe WABA?
    - WABA lista telefones?
    - número salvo tem `phone_number_id` real?
    - reachestimate aceita Página + número?
  - Isso evita ficar “tentando publicar” para descobrir o erro.

## Passos externos que ainda serão necessários na Meta

Mesmo com código corrigido, a publicação só vai funcionar se um destes caminhos ficar verdadeiro:

1. A Página `Instituto dos Sonhos` estiver vinculada à WABA que contém o número `+55 34 98431-4317`; ou
2. O `phone_number_id` real desse número for salvo no sistema e a conta de anúncios tiver permissão para usá-lo; ou
3. A conta da plataforma for reconectada aceitando `whatsapp_business_management`, permitindo ao sistema descobrir automaticamente a WABA e o telefone.
4. Eu acho que nao rem o 9, fa. O teste e a análise 

## Arquivos a alterar quando aprovado

- `supabase/functions/_shared/resolve-waba-phone.ts`
- `supabase/functions/facebook-create-campaign/index.ts`
- `supabase/functions/facebook-preflight-check/index.ts`
- `supabase/functions/facebook-auto-fix-whatsapp/index.ts`
- `src/components/admin/DadosTab.tsx`

## Validação

- Consultar logs de `facebook-create-campaign` após a alteração.
- Testar `facebook-auto-fix-whatsapp` via Edge Function.
- Confirmar que o erro mostrado ao usuário não causa tela branca e aponta para o vínculo correto Página ↔ WABA ↔ phone_number_id.