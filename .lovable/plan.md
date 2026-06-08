# Painel de Suporte Remoto — Tela cheia e melhorias

Foco: deixar o painel do operador mais rápido, profissional e com modo tela cheia para você operar sem distração.

## 1. Modo tela cheia (Fullscreen real)
- Botão "Tela cheia" no topo do vídeo usando a Fullscreen API (`requestFullscreen` no container do vídeo + overlay de controle).
- Atalho **F11** local (capturado só no painel) e **ESC** para sair.
- Ao entrar em fullscreen: esconder cabeçalho/sidebar do Admin, vídeo ocupa 100% da tela, overlay de controle remoto continua ativo por cima.
- Layout cinema: fundo preto, vídeo centralizado com `object-contain`, barra flutuante de ações no rodapé que some após 3s sem movimento do mouse (estilo player).

## 2. Barra de ações profissional (flutuante)
Substitui os botões soltos atuais. Agrupa em uma toolbar única no topo/rodapé do vídeo:
- **Controle ATIVO / Visualizar** (toggle existente, com indicador colorido).
- **Tela cheia / Sair**.
- **Qualidade** (Auto / Alta / Média / Baixa) — ajusta `frameRate` e `scaleResolutionDownBy` do sender via `RTCRtpSender.setParameters()` sem reconectar.
- **Mudo do consultor** (apenas visual no banner — o consultor mantém controle real).
- **Tirar screenshot** — captura o frame atual do vídeo em PNG e baixa.
- **Copiar código da sessão**.
- **Encerrar sessão** (vermelho, confirmação).

## 3. Atalhos de teclado (quando o painel tem foco)
- `Ctrl+Shift+C` — alternar controle ativo/visualizar.
- `Ctrl+Shift+F` — fullscreen.
- `Ctrl+Shift+S` — screenshot.
- `Ctrl+Shift+E` — encerrar sessão (com confirmação).
- Setas/PageUp/PageDown enviados como `wheel`/`key` para o consultor.

## 4. Performance e responsividade do controle
- **Throttle inteligente de mouseMove**: hoje envia a cada movimento; passar para ~30 msg/s via `requestAnimationFrame` + coalescing (só envia a última posição por frame). Reduz tráfego no DataChannel e elimina lag percebido.
- **Cursor remoto**: desenhar um cursor virtual sobre o vídeo mostrando onde o operador está clicando, com flash no clique (feedback imediato sem esperar o vídeo).
- **Coalescing de wheel**: somar deltas dentro do mesmo frame antes de enviar.
- **Indicador de latência (RTT)**: pequeno badge com ping medido via DataChannel (envia `ping` a cada 2s, mede ida e volta). Verde <100ms, amarelo <300ms, vermelho acima.
- **Indicador de FPS recebido** usando `RTCStatsReport` (framesPerSecond do track de vídeo).

## 5. Conforto operacional
- **Painel lateral colapsável** com:
  - Log ao vivo de comandos (últimos 50, com status ok/erro).
  - Lista de URLs/abas do consultor + botão "Ir para esta URL".
  - Histórico de screenshots tirados na sessão.
- **Modo claro/escuro do player** independente do tema do Admin.
- **Lembrar preferências** (controle ativo, qualidade, fullscreen) em `localStorage` por operador.

## 6. Segurança visível
- Banner persistente no consultor já existe — adicionar timer ("sessão ativa há 03:42") visível para ambos os lados.
- Botão "Pausar controle" do lado do consultor (kill switch instantâneo) — quando pausado, o operador vê overlay "Consultor pausou o controle".

## Arquivos a alterar

```text
src/pages/SuperAdminRemoteSupport.tsx     → fullscreen, toolbar, atalhos, painel lateral, cursor remoto, badges
src/features/remote-support/screenShare.ts → API de qualidade (setParameters), ping/stats helpers
src/features/remote-support/types.ts       → comandos novos: pause, resume, qualityChange
src/features/remote-support/actionHandler.ts → handler de pause/resume
src/features/remote-support/ActiveSessionBanner.tsx → timer + botão pausar
```

## Fora deste plano (posso fazer depois se quiser)
- Gravação da sessão em vídeo (MediaRecorder do track recebido).
- Áudio bidirecional (mic do operador).
- Anotações desenháveis sobre a tela do consultor.
- Transferência de arquivos pelo DataChannel.

Confirma que quer tudo isso, ou prefere que eu corte algo (por ex. deixar para depois o painel lateral / cursor remoto) para entregar mais rápido?
