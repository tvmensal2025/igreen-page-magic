# Ajustar fluxo de boas-vindas e simulação

Vou reorganizar o fluxo do bot do WhatsApp para voltar ao formato original de boas-vindas com 3 botões, adicionando uma etapa intermediária quando o lead escolher simular.

## Estrutura final do fluxo

```
d_welcome (3 botões)
 ├── Quero simular ──► d_escolher_simulacao (NOVA, 2 botões)
 │                       ├── Simulação completa ──► d_pedir_conta (foto da conta)
 │                       └── Simulação rápida   ──► d_simular_valor (digita valor)
 │                                                     └─► d_simular_resultado (3 botões)
 │                                                           ├── Continuar Cadastro ──► d_pedir_conta
 │                                                           ├── Ainda tenho dúvida  ──► (dúvidas)
 │                                                           └── Falar com Rafael    ──► humano
 ├── Como funciona ──► d_como_funciona (inalterado)
 └── Falar com Rafael ──► humano
```

## Mudanças

### 1. `d_welcome` — voltar ao original com 3 botões

Texto:

> Olá, seja muito *Bem-Vindo(a)*! 😊
>
> Sou a assistente virtual do *{{representante}}* e vou te mostrar se a sua conta de luz tem perfil pra *economizar todo mês* com a iGreen 💚
>
> Como posso te ajudar?

Botões:

- 💚 Quero simular
- 🤔 Como funciona
- 👨‍💼 Falar com Rafael

### 2. Nova etapa `d_escolher_simulacao` (intermediária)

Texto:

> Show! 🙌 Você prefere qual tipo de simulação?
>
> 📸 *Simulação completa* — me manda a foto da conta de luz e eu calculo o valor exato.
>
> 💡 *Simulação rápida* — me diz só o valor médio da conta e eu já te dou uma prévia.

Botões:

- 📸 Simulação completa → `d_pedir_conta`
- 💡 Simulação rápida → `d_simular_valor`

### 3. `d_simular_resultado` — trocar para os mesmos 3 botões do `d_como_funciona`

Texto (novo): mudar igual o outro calculando

> Olha que ótimo! 👀✨🎉 
>
> 💡 Sua conta hoje: *R$ {{valor_conta}}*
>
> 💚 Economia estimada: *{{economia_range}}* por mês
>
> E o melhor:
>
> ✅ Sem investimento
>
> ✅ Sem obra
>
> ✅ Sem instalação
>
> ✅ *Mesma* distribuidora 
>
> Bora cadastrar? É *gratuito* e *sem fidelidade*.🚀

Botões (iguais ao d_como_funciona):

- Continuar Cadastro → `d_pedir_conta`
- Ainda tenho dúvida → mesma etapa de dúvidas usada hoje pelo `d_como_funciona`
- Falar com Rafael → humano

### 4. `d_simular_valor` — sem alteração de texto/captura

Apenas continua redirecionando para `d_simular_resultado`.

## Detalhes técnicos

- Migração SQL única em `bot_flow_steps` usando `INSERT ... ON CONFLICT (id) DO UPDATE` para `d_welcome`, `d_simular_resultado` e a nova `d_escolher_simulacao`.
- Nova etapa recebe um UUID fixo (ex.: `b1a53333-3333-4333-8333-000000000003`) para ser referenciada nas transições do `d_welcome`.
- Transições do `d_welcome` passam a ser:
  - `simular|quero simular|simulação` → `d_escolher_simulacao`
  - `como|como funciona` → `d_como_funciona` (mantido)
  - `humano|rafael|atendente|falar` → especial `humano` (mantido)
- Transições do `d_escolher_simulacao`:
  - `completa|foto|conta` → `d_pedir_conta`
  - `rapida|rápida|valor|só o valor` → `d_simular_valor`
- Transições do `d_simular_resultado` passam a espelhar as do `d_como_funciona` (`cadastrar` / `duvida` / `humano`).
- Sem mudanças em código frontend ou edge functions.

> Observação: o diretório `.lovable/` está no `.gitignore` do projeto, então este plano não será versionado. Se quiser que os planos persistam, remova essa entrada do `.gitignore`.