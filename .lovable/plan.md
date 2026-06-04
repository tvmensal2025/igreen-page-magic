## Diagnóstico

O domínio `igreen.cloud` está correto e o consultor `rafael-ferreira` existe no banco. A página retorna "Consultor não encontrado" porque a query do `useConsultant` falha por permissão:

- A view `public.consultants_public` está criada com `WITH (security_invoker=on)`.
- Com `security_invoker=on`, quando o role `anon` consulta a view, o Postgres tenta ler a tabela base `public.consultants` usando a permissão do próprio anon.
- O anon não tem `SELECT` em `public.consultants` (e nem deveria ter — a tabela tem colunas sensíveis).
- Resultado: PostgREST devolve `42501 permission denied for table consultants`, o front trata como "sem dados" e mostra a tela de erro.

Verificado com requisição direta ao PostgREST usando a anon key publicada — retorna `permission denied for table consultants`.

## Mudança

Migração única que troca o modo da view para `security_definer` (executa com a permissão do dono da view, que tem acesso à `consultants`) e garante o GRANT de leitura para `anon` e `authenticated` na própria view. A view continua expondo apenas as colunas públicas já definidas (sem e-mail, sem dados sensíveis), então o risco de exposição não muda — só a forma como a permissão é checada.

```sql
ALTER VIEW public.consultants_public SET (security_invoker = off);
GRANT SELECT ON public.consultants_public TO anon, authenticated;
```

## Verificação

Depois da migração:

1. `curl` no PostgREST com a anon key em `consultants_public?license=eq.rafael-ferreira` deve retornar a linha do Rafael.
2. Abrir `https://igreen.cloud/rafael-ferreira` deve renderizar a landing page do consultor (sem "Consultor não encontrado").
3. O preview dentro de `/admin → Links → Página de Cliente` deve abrir a landing correta.  
TODOS OS CONSULTORES QUE COLOCAR O NOME EM DADOS VAI TER SUA PAGINA PUBLICA

## Fora de escopo

- Não mexer no `baseUrl` (já está em `igreen.cloud`, que é o domínio correto).
- Não mexer em `useConsultant`, `ConsultantPage`, `HeroSection`, ou Central de Anúncios.
- Não alterar grants da tabela `consultants` (continua sem acesso direto pelo anon).