## Objetivo

Gerar uma nova `LOVABLE_API_KEY` para você copiar no Easypanel do `worker-igreen-sync`, mantendo a camada de debug com IA (Gemini Vision) ativa no pipeline v10.

## Passos

1. **Rotacionar a chave**
  - Executar `ai_gateway--rotate_lovable_api_key`.
  - Isso invalida a chave antiga (em até 1h) e cria uma nova ativa.
2. **Exibir o novo valor**
  - Após rotacionar, mostrar a nova `LOVABLE_API_KEY` no chat para você copiar.
  - Importante: a chave nova passa a valer também dentro do projeto Lovable (edge functions etc.), então qualquer edge function que use a chave continua funcionando automaticamente — só o worker externo (Easypanel) precisa receber o valor manualmente.
3. **Instruções para o Easypanel**
  - Abrir o serviço `worker-igreen-sync` → aba **Environment**.
  - Adicionar/atualizar:
    ```
    LOVABLE_API_KEY=<valor novo colado>
    ```
  - Salvar e **Rebuild** (ou pelo menos Restart se a imagem já estiver pronta).
  - Validar:
    - `GET /health` → deve retornar `mode: "tor+playwright+2captcha-v10"` e `ai_debug: true`.
    - Clicar em "Sincronizar" no admin.
    - `GET /last-debug` deve mostrar as descrições do Gemini para cada screenshot.

## Observações

- Nenhum arquivo do código precisa mudar — o pipeline v10 já lê `LOVABLE_API_KEY` do `process.env`.
- Se rotacionar a chave quebrar algo dentro do projeto Lovable, basta rotacionar de novo (é idempotente).
- A chave é sensível: não comitar em código, somente no painel de variáveis do Easypanel.

Confirma que posso prosseguir com a rotação? SIM 