Diagnóstico encontrado:

- As credenciais estão salvas no banco para o consultor Rafael.
- A função `sync-igreen-customers` está carregando essas credenciais salvas corretamente.
- O erro real vem do próprio portal iGreen no login: `401 - Unauthorized action`.
- Portanto, o problema não é que o app perdeu os dados; o portal está recusando a autenticação feita pela função.

Plano de correção:

1. Ajustar o login da função iGreen
   - Normalizar email e senha antes de enviar ao portal.
   - Testar variações seguras do payload de login aceitas pelo portal, mantendo compatibilidade com o formato atual.
   - Melhorar os headers para se aproximar mais da chamada real do portal.

2. Evitar usar credencial antiga por engano
   - Quando o usuário informar email/senha na tela, a função deve tentar primeiro os dados enviados naquele momento.
   - Se não vierem dados no corpo da chamada, aí sim usa os dados salvos no banco.
   - Isso evita que a sincronização use uma senha antiga salva anteriormente.

3. Melhorar a mensagem na tela
   - Se o portal retornar `401 Unauthorized action`, mostrar uma mensagem mais clara: “O portal iGreen recusou o login. Os dados estão salvos, mas o portal não aceitou essa combinação agora.”
   - Mostrar também quando o app está usando dados salvos ou dados recém-digitados.

4. Adicionar logs seguros para diagnóstico
   - Registrar qual origem da credencial foi usada: `body` ou `database`.
   - Registrar status HTTP e resposta curta do portal.
   - Nunca exibir nem registrar a senha.

Arquivos envolvidos:

- `supabase/functions/sync-igreen-customers/index.ts`
- `src/components/admin/DashboardTab.tsx`
- `src/components/admin/NetworkPanel.tsx`

Resultado esperado:

- Se a senha estiver realmente válida para o endpoint atual do portal, a sincronização passa a baixar clientes e rede.
- Se o portal continuar recusando, a tela vai mostrar o motivo real e ficará claro que os dados estão salvos, mas o login foi negado pelo iGreen.