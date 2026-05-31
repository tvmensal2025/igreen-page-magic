## Configurar cron jobs do super-admin

Gerar um arquivo `cron_setup.sql` com os comandos prontos para colar no SQL Editor do Supabase, agendando os 3 jobs críticos via `pg_cron` + `pg_net`.

### Jobs a agendar

| Nome | Frequência | Edge function |
|------|-----------|---------------|
| `minio-quota-check` | a cada 15 min | `/functions/v1/minio-quota-check` |
| `super-admin-alerts` | a cada 5 min | `/functions/v1/super-admin-alerts` |
| `instance-health-cron` | a cada 10 min | `/functions/v1/instance-health-cron` |

### O que o SQL faz

1. `CREATE EXTENSION IF NOT EXISTS pg_cron;` e `pg_net;`
2. `cron.unschedule(...)` defensivo (caso já existam jobs com o mesmo nome)
3. `cron.schedule(...)` para cada um dos 3 jobs, chamando `net.http_post` com a URL completa do projeto (`https://zlzasfhcxcznaprrragl.supabase.co/functions/v1/...`) e o anon key no header `apikey`
4. `SELECT * FROM cron.job;` no final para o usuário confirmar que os 3 jobs ficaram registrados

### Entregável

Arquivo `cron_setup.sql` na raiz do projeto, com cabeçalho explicando: "Cole tudo no SQL Editor (https://supabase.com/dashboard/project/zlzasfhcxcznaprrragl/sql/new) e clique em Run."

Não roda migration — é SQL one-shot que o usuário executa manualmente (contém anon key específico do projeto e não deve ir para `supabase/migrations/`).