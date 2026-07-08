## Plano: destravar o Auth

### Problema observado
- O usuário preenche e clica em **Entrar**.
- O botão fica em loading indefinidamente.
- No teste local, `signInWithPassword()` ficou preso e **nenhuma requisição para o Supabase** foi disparada.
- Isso indica travamento no cliente de auth antes da chamada de rede, não erro de senha nem erro de RLS.

### Correção proposta
1. **Adicionar timeout no login**
   - Envolver `supabase.auth.signInWithPassword()` em um limite curto de tempo.
   - Se travar, liberar o botão e mostrar mensagem clara para o usuário tentar novamente.

2. **Criar retry/fallback seguro do cliente auth**
   - Ajustar a configuração do Supabase client para evitar lock preso do navegador durante autenticação.
   - Manter sessão persistente e refresh automático.

3. **Impedir loading infinito em todos os fluxos de auth**
   - Aplicar proteção contra travamento no login.
   - Revisar recuperação de senha e troca de senha para não deixar botão travado em caso de promessa pendente.

4. **Validar no preview**
   - Testar `/auth` com tentativa de login.
   - Confirmar que o botão sempre volta do loading e que erros aparecem na tela.
   - Confirmar que a chamada ao Supabase volta a acontecer ou, se a rede travar, o usuário recebe feedback.

### Arquivos envolvidos
- `src/pages/Auth.tsx`
- `src/integrations/supabase/client.ts`, se necessário para ajustar a estratégia de lock/auth

### Resultado esperado
- Login não fica mais travado.
- O botão “Entrar” sempre destrava.
- Quando houver falha real, aparece mensagem de erro clara em vez de spinner infinito.