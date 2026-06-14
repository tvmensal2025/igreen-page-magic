# Wizard "Criar Campanha" — Modelo A (Sidebar + Preview)

## Visão geral
Layout full-screen com 3 colunas:
- **Sidebar esquerda** (220px): steps numerados + saldo da carteira
- **Main central** (flex-1): conteúdo do step ativo
- **Preview direita** (320px): celular WhatsApp + preview do anúncio

## Estrutura de arquivos

```
campaign-wizard/
├── index.tsx                  → Re-export público
├── ARCHITECTURE.md            → Este documento
├── CampaignWizardModal.tsx    → Container (fullscreen dialog + grid 3 colunas)
├── WizardSidebar.tsx          → Sidebar com steps + carteira
├── WizardPreview.tsx          → Preview celular + card de anúncio
├── WizardFooter.tsx           → Barra inferior (voltar + próximo/publicar)
├── steps/
│   ├── StepRegion.tsx         → Step 1: geo (distribuidora/cidades ou raio)
│   ├── StepCreative.tsx       → Step 2: upload fotos/vídeo
│   ├── StepCopy.tsx           → Step 3: headline + texto + msg WhatsApp + IA
│   ├── StepBudget.tsx         → Step 4: orçamento + duração + placements
│   └── StepReview.tsx         → Step 5: resumo final + preflight + publicar
├── hooks/
│   ├── useWizardState.ts      → Estado central (53 useState → 1 hook reducer)
│   ├── usePresetCities.ts     → Cache de distribuidoras + busca bulk
│   ├── useCopyGenerator.ts    → Gera copy via IA (ad-creative-builder)
│   └── usePublish.ts          → Upload de mídia + createCampaign + retry
└── wizard.css                 → Tema visual Modelo A (vars CSS)
```

## Interfaces

### WizardState (retornado por useWizardState)
```ts
interface WizardState {
  step: 1 | 2 | 3 | 4 | 5;
  // Region
  geoMode: "cities" | "radius";
  cities: CityHit[];
  selectedPresetIds: Set<string>;
  radiusPoints: RadiusPoint[];
  liveReach: { lower: number; upper: number } | null;
  // Creative
  creativeMode: "photo" | "video";
  filesByFormat: FilesByFormat;
  videoFile: File | null;
  videoUrl: string | null;
  videoMeta: { duration: number; w: number; h: number } | null;
  // Copy
  headline: string;
  primaryText: string;
  description: string;
  initialMessage: string;
  initialMsgDuplicate: boolean;
  // Budget
  budget: number;
  duration: number;
  placementMode: "auto" | "manual";
  placements: string[];
  // Global
  submitting: boolean;
  preflight: PreflightResult | null;
}

interface WizardActions {
  setStep(s: 1|2|3|4|5): void;
  goNext(): Promise<void>;       // valida + avança
  goBack(): void;                // volta 1 step
  // ... delegados por step
}
```

### Props de cada Step
```ts
interface StepProps {
  state: WizardState;
  actions: WizardActions;
  consultantId: string;
}
```

### WizardPreview props
```ts
interface PreviewProps {
  headline: string;
  primaryText: string;
  imageUrl: string | null;
  initialMessage: string;
  whatsappNumber: string;
  pageName: string;
}
```

## Design visual (tokens oficiais iGreen — alinhados ao painel-elite)
- `--ads-bg`: fundo `#F7F9F8` (152 16% 97%)
- `--ads-surface`: branco `#FFFFFF`
- `--ads-border`: bordas `#E5E7EB` (220 13% 91%)
- `--ads-emerald`: verde primário `#00A859` (152 100% 33%)
- `--ads-emerald-2`: verde escuro `#007A3D` (150 100% 24%)
- `--ads-text`: texto principal `#1F2937`
- `--ads-muted`: texto secundário
- Tipografia: **Figtree** (corpo) + **Outfit** (títulos/KPIs)
- Componentes: `AdsButton` (primary/secondary/ghost/nav/cta), `.ads-select-card` (cards selecionáveis)

## Regras de implementação
1. Cada arquivo tem NO MÁXIMO 250 linhas (exceto useWizardState que pode ter ~350)
2. Zero lógica de negócio nos componentes visuais (vai nos hooks)
3. Preview atualiza em tempo real conforme o usuário preenche
4. Sidebar mostra ✓ nos steps concluídos, número nos pendentes
5. Mobile: sidebar vira header horizontal; preview some (aparece só no Step 5)
6. Transição entre steps: slide horizontal (CSS transform)
7. O Dialog usa `max-w-[1200px]` no desktop, `max-w-full` no mobile

## Componentes reutilizáveis criados
- `src/components/ui/combobox.tsx` — seletor com busca (single + multi-select).
  Construído sobre Popover + Command (cmdk), padrão oficial shadcn.
  USAR no StepRegion para distribuidoras (multi) e cidades (busca).
  Resolve o problema de listas grandes que poluíam a tela.
  Props: `{ options, value, onChange, multiple?, placeholder, ... }`
  ComboboxOption: `{ value, label, hint?, group?, disabled? }`

## Animações (framer-motion@12.40.0 — instalado)
Import correto (validado via Context7):
```ts
import { motion, AnimatePresence } from "framer-motion";
```
Padrão para transição entre steps (slide horizontal):
```tsx
<AnimatePresence mode="wait" initial={false} custom={direction}>
  <motion.div
    key={step}
    custom={direction}
    initial={{ opacity: 0, x: direction > 0 ? 40 : -40 }}
    animate={{ opacity: 1, x: 0 }}
    exit={{ opacity: 0, x: direction > 0 ? -40 : 40 }}
    transition={{ duration: 0.22, ease: "easeOut" }}
  >
    {/* conteúdo do step */}
  </motion.div>
</AnimatePresence>
```
- `direction` = +1 ao avançar, -1 ao voltar (guardar no state)
- `mode="wait"` = um step sai antes do próximo entrar (sem sobreposição)
- `initial={false}` = não anima na primeira montagem (evita "pulo" ao abrir)

## Bibliotecas JÁ instaladas para aproveitar (zero install)
- `@dnd-kit/core` + `sortable` → drag-and-drop no upload de fotos (StepCreative)
- `canvas-confetti` → celebração ao publicar (StepReview, no sucesso)
- `embla-carousel-react` → carrossel de preview dos 3 formatos (StepReview)
- `recharts` → barra visual de alcance estimado (StepRegion)
- `vaul` → drawer no mobile (CampaignWizardModal responsivo)
- `react-hook-form` + `zod` → validação robusta (opcional, reforça os steps)

