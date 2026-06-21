# Plano: Horários falados de forma natural no AudioStudio

## Problema
Hoje a função `horarioExtenso` (em `src/components/admin/AudioStudio.tsx`, linha 323) traduz o horário em formato 24h literal:
- `17` → "dezessete horas"
- `18` → "dezoito horas"
- `6` → "seis horas"

Resultado: o ElevenLabs lê de forma robótica e ambígua. O usuário quer pronúncia natural de rádio:
- `17` → "cinco da tarde"
- `6` → "seis da manhã"
- `Das 11 às 16` → "das onze da manhã às quatro da tarde"

## Solução

### 1. Nova função `horarioFalado(h)` — período do dia embutido
Mapa de períodos:
| Hora 24h | Fala |
|---|---|
| 0:00 | "meia-noite" |
| 1–4 | "X da madrugada" |
| 5–11 | "X da manhã" |
| 12:00 | "meio-dia" |
| 13–17 | converte (13→1 … 17→5) + "da tarde" |
| 18–23 | converte (18→6 … 23→11) + "da noite" |

Minutos:
- `:00` → omite
- `:30` → "e meia"
- outros → "e X minutos"

### 2. Nova função `horarioRangeFalado(inicio, fim)` — período compartilhado
Quando início e fim caem no mesmo período, fala o período só no fim:
- `8` → `12` → "das oito ao meio-dia"
- `14` → `17` → "das duas às cinco da tarde"
- `11` → `16` → "das onze da manhã às quatro da tarde" (períodos diferentes → cada um leva o seu)
- `19` → `22` → "das sete às dez da noite"

Concordância:
- `às` antes de número feminino normal
- `ao` antes de "meio-dia"
- `à` antes de "meia-noite" / "uma da..."

### 3. Substituir no template (linha 540)
```
const horarioP = `${horarioRangeFalado(horaInicio || "8", horaFim || "18")}.`;
```

### 4. Preview na UI (linha 1115)
Trocar o `horarioExtenso(f.value)` individual por uma linha única abaixo dos dois inputs mostrando o range falado, para o usuário ver exatamente como vai sair na voz.

### 5. Cache TTS
O cache é por texto (`getCachedTTS(text)`). Como o texto do segmento de horário muda, áudios antigos continuam válidos (não colidem) e os novos são gerados uma vez e reusados. Sem migração necessária.

### 6. Botão de baixar
Já existe (linhas 969–985, ícone `Download` na linha 1274) e baixa duas versões (com e sem vinheta). Sem mudança — só vou confirmar visualmente que está acessível no mesmo bloco do botão de tocar/pausar.

## Arquivos alterados
- `src/components/admin/AudioStudio.tsx` — substitui `horarioExtenso` por `horarioFalado` + adiciona `horarioRangeFalado`; ajusta linha 540 e o preview da linha 1115.

## Testes manuais
1. `8` → `18` → "das oito da manhã às seis da tarde."
2. `14` → `17` → "das duas às cinco da tarde."
3. `11` → `16` → "das onze da manhã às quatro da tarde."
4. `8` → `12` → "das oito da manhã ao meio-dia."
5. `19` → `23` → "das sete às onze da noite."
6. `8:30` → `17:30` → "das oito e meia da manhã às cinco e meia da tarde."

Gerar TTS em cada caso e ouvir.
