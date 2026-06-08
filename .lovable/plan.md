
## Problema

A extensão está apontando para `app.igreenenergia.com.br`, mas o portal correto é `escritorio.igreenenergy.com.br` (com **energy**, não energia, e subdomínio **escritorio**). Por isso ela não consegue ler nenhum cliente — está buscando em um domínio onde você não está logado, todas as requisições falham e nenhum dado é enviado.

## O que vou ajustar

**1. `extension/igreen-sync/manifest.json`**
Trocar `host_permissions` para o domínio certo:
```
https://escritorio.igreenenergy.com.br/*
https://*.igreenenergy.com.br/*
```
(mantém o host do Supabase)

**2. `extension/igreen-sync/background.js`**
- `IGREEN_ORIGIN = "https://escritorio.igreenenergy.com.br"`
- Atualizar a lista de endpoints candidatos para ler clientes:
  - `/customer-map`
  - `/api/customer-map`
  - `/api/customer/list`
  - `/customer/list`
- Melhorar mensagem de erro mostrando qual URL falhou e com que status (assim, se nenhum endpoint bater, a gente identifica rápido o caminho real chamando o que o portal usa).

**3. `extension/igreen-sync/popup.js`**
Mostrar no popup uma linha extra do tipo "Portal: escritorio.igreenenergy.com.br — confirme que está logado" para o consultor saber onde precisa estar logado antes de sincronizar.

**4. Republicar o ZIP**
Recriar `public/igreen-sync-extension.zip` com os 5 arquivos atualizados, para que o próximo download do admin já venha corrigido.

**5. Sem mudanças** em banco de dados, edge function (`igreen-ingest-customers` continua igual), nem nos componentes React (`IGreenExtensionCard`, `DadosTab`, popup de onboarding).

## O que preciso confirmar com você

Para garantir que a extensão leia **todos** os clientes na primeira tentativa, me confirma uma coisa olhando o portal aberto no seu navegador:

1. Abre `https://escritorio.igreenenergy.com.br/`, vai na tela onde aparecem seus clientes.
2. Aperta **F12** → aba **Network** → filtra por `Fetch/XHR` → recarrega a página.
3. Me diz o caminho da requisição que retorna a lista (algo como `/customer-map`, `/api/customers`, `/clientes/listar`, etc.) e se a resposta é JSON.

Se você não conseguir pegar isso agora, eu já deixo a extensão tentando os 4 caminhos mais prováveis e mostro no popup qual deu certo / qual falhou, e a gente ajusta na próxima rodada.
