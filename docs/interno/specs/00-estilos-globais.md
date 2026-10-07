# 00 - Estilos globais (tokens, classes Nocturne, animações, switch, toast, overlay/drawer)

Fonte: `PearChat.dc.html` (linhas 15-32 e 155 para escopos de tema) e `_ds/nocturne-.../styles.css`.

## 1. Como o tema é montado (IMPORTANTE)

O protótipo carrega o `styles.css` do Nocturne (que define `:root` com a paleta roxa original) e **sobrescreve os tokens por escopo inline**:

- **Wrapper raiz** (div que contém `<aside>` e `<main>`): define o tema **escuro "pera"** (usado pelo menu lateral). Estilo inline literal:

```
--color-accent:#a8c23a; --color-accent-900:#1f2512; --color-accent-800:#2c3617; --color-accent-700:#41511e; --color-accent-600:#6a8226; --color-accent-500:#a8c23a; --color-accent-400:#bcd35a; --color-accent-300:#cfe07e; --color-accent-200:#e0eba6; --color-accent-100:#eff5d0; --color-bg:#14170f; --color-surface:#1d2117; --color-text:#eef0e8; --color-divider:#2e3426; --color-neutral-900:#262b1f; --color-neutral-800:#333a2a; --color-neutral-700:#4a5240; --color-neutral-600:#69725d; --color-neutral-500:#8a927d; --color-neutral-400:#a9b09d; --color-neutral-300:#c6ccbb; --color-neutral-200:#dde1d4; --color-neutral-100:#eef0e8;
display:flex; height:100vh; overflow:hidden; background:var(--color-bg); color:var(--color-text); font-family:var(--font-body); font-size:13.5px
```

- **`<main>`** (área principal, drawers, toast ficam DENTRO dele): redefine para **tema claro**. Estilo inline literal:

```
flex:1; min-width:0; display:flex; flex-direction:column; position:relative; color-scheme:light;
--color-bg:#f6f7ef; --color-surface:#ffffff; --color-text:#1d2117; --color-divider:#e3e7d6;
--color-neutral-900:#eff1e6; --color-neutral-800:#e2e6d5; --color-neutral-700:#c9cfb8; --color-neutral-600:#a3aa92; --color-neutral-500:#727a63; --color-neutral-400:#565c4a; --color-neutral-300:#3e4335; --color-neutral-200:#2c3025; --color-neutral-100:#1d2117;
--color-accent-900:#f3f7e2; --color-accent-800:#e6efc3; --color-accent-700:#d1e092; --color-accent-600:#b3ca52; --color-accent-400:#86a028; --color-accent-300:#667c1f; --color-accent-200:#4f6118; --color-accent-100:#3a4711;
color:#1d2117; background:var(--color-bg)
```

  Observações: `--color-accent` e `--color-accent-500` **não** são redefinidos em `main`; herdam do wrapper (`#a8c23a`). Logo `.btn-primary` na área clara usa `#a8c23a` como cor de texto e borda sobre fundo branco/claro.
  Como o drawer, o overlay e o toast são filhos de `<main>`, eles usam o tema CLARO.

### Tabela de cores resolvidas

| Token | Menu lateral (escuro) | Área principal / drawer / toast (claro) |
|---|---|---|
| bg | `#14170f` | `#f6f7ef` |
| surface | `#1d2117` | `#ffffff` |
| text | `#eef0e8` | `#1d2117` |
| divider | `#2e3426` | `#e3e7d6` |
| accent / accent-500 | `#a8c23a` | `#a8c23a` (herdado) |
| accent-900 | `#1f2512` | `#f3f7e2` |
| accent-800 | `#2c3617` | `#e6efc3` |
| accent-700 | `#41511e` | `#d1e092` |
| accent-600 | `#6a8226` | `#b3ca52` |
| accent-400 | `#bcd35a` | `#86a028` |
| accent-300 | `#cfe07e` | `#667c1f` |
| accent-200 | `#e0eba6` | `#4f6118` |
| accent-100 | `#eff5d0` | `#3a4711` |
| neutral-900 | `#262b1f` | `#eff1e6` |
| neutral-800 | `#333a2a` | `#e2e6d5` |
| neutral-700 | `#4a5240` | `#c9cfb8` |
| neutral-600 | `#69725d` | `#a3aa92` |
| neutral-500 | `#8a927d` | `#727a63` |
| neutral-400 | `#a9b09d` | `#565c4a` |
| neutral-300 | `#c6ccbb` | `#3e4335` |
| neutral-200 | `#dde1d4` | `#2c3025` |
| neutral-100 | `#eef0e8` | `#1d2117` |

Cores literais fora dos tokens usadas no protótipo:

| Uso | Valor |
|---|---|
| Knob "ligado" do switch, texto sobre acento (contador, selo ✦, número do dia de hoje) | `#fbfcf3` |
| Número de passo concluído do fluxo oficial ("✓") | `#f6f7ef` |
| Box âmbar (fundo / borda / texto) | `#fbf5e8` / `#ecd9b3` / `#6b5427` |
| Ícone de aviso/âmbar (cartão "Conexão rápida", status "Em análise") | `#b0872f` |
| Evento "Manual" e agenda "Pessoal" | `#d9a35b` |
| Evento "Google" e agenda "Feriados no Brasil" | `#5fa7a0` (README diz `#6bb39a`: divergência, o HTML usa `#5fa7a0`) |
| Overlay do drawer | `color-mix(in srgb, #1d2117 30%, transparent)` |
| Sombra do drawer | `-24px 0 60px color-mix(in srgb, #1d2117 16%, transparent)` |

## 2. Tokens base do Nocturne (`styles.css`, `:root`)

Os de cor são sobrescritos acima; os que seguem NÃO são sobrescritos e valem como estão:

```css
--font-heading: "Inter", system-ui, sans-serif;
--font-heading-weight: 500;
--font-body: "Inter", system-ui, sans-serif;

--space-1: 2.8px;
--space-2: 5.6px;
--space-3: 8.4px;
--space-4: 11.2px;
--space-6: 16.8px;
--space-8: 22.4px;

--radius-sm: 4px;
--radius-md: 8px;
--radius-lg: 14px;   /* README diz 12px; o CSS real é 14px */

--shadow-sm: 0 0 0 1px #3f424d;
--shadow-md: 0 0 0 1px #595d6c, 0 6px 18px rgba(0,0,0,0.55);
--shadow-lg: 0 0 0 1px #9397ab, 0 16px 40px rgba(0,0,0,0.65);
```

(As sombras são hex literais, não acompanham o tema claro. `elev-md` é usado nos cartões de conexão; `elev-lg` no toast.)

Valores de `:root` do Nocturne que são sobrescritos pelo wrapper e só valem se o escopo inline faltar: `--color-bg:#161826; --color-surface:#232532; --color-text:#e9e9ed; --color-accent:#9184d9; --color-accent-2:#a7a1db; --color-divider:color-mix(in srgb, #e9e9ed 16%, transparent)`, rampas neutral/accent/accent-2 roxas, `--color-section*`. Não são usados visualmente no PearChat, exceto `html, body { background: var(--color-bg) }` (roxo `#161826` fora do wrapper, invisível porque o wrapper cobre 100vh).

Fonte: `@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap');`. Ícones Phosphor 2.1.1 (`regular/style.css` e `fill/style.css` via unpkg; também `ph-bold` é usado no check das caixas de agendas).

## 3. CSS global do Nocturne (literal, partes usadas)

```css
*, *::before, *::after { box-sizing: border-box; }
body { margin: 0; font-size: 15px; line-height: 1.55; font-weight: 400; }
h1..h6 { font-family: var(--font-heading); font-weight: var(--font-heading-weight); line-height: 1.12; letter-spacing: -0.015em; margin: 0 0 var(--space-2); }
p { margin: 0 0 var(--space-3); }
a { color: var(--color-accent); text-underline-offset: 3px; }
img { display: block; max-width: 100%; }
.text-muted { color: color-mix(in srgb, var(--color-text) 55%, transparent); }
:focus { outline: none; }
:focus-visible { outline: 2px solid var(--color-accent); outline-offset: 2px; }
::selection { background: color-mix(in srgb, var(--color-accent) 30%, transparent); }
```

CSS adicional do protótipo (`<helmet><style>`):

```css
html, body { margin: 0; padding: 0; background: var(--color-bg); }
* { box-sizing: border-box; }
a { color: var(--color-accent-300); text-decoration: none; }
a:hover { color: var(--color-accent-200); }
::-webkit-scrollbar { width: 10px; height: 10px; }
::-webkit-scrollbar-thumb { background: #c9cfb8; border-radius: 8px; border: 2px solid transparent; background-clip: padding-box; }
::-webkit-scrollbar-track { background: transparent; }
```

## 4. Classes utilitárias (CSS literal)

### .btn e variantes

```css
.btn {
  display: inline-flex; align-items: center; justify-content: center; gap: 6px;
  cursor: pointer; text-decoration: none;
  font-family: var(--font-heading); font-weight: var(--font-heading-weight);
  font-size: 14px; line-height: 1.2; color: var(--color-text);
  background: transparent; border: 1px solid transparent;
  padding: var(--space-2) calc(var(--space-3) * 1.2);   /* 5.6px 10.08px */
  border-radius: var(--radius-md);
}
.btn svg { display: block; }
.btn:disabled { opacity: 0.45; cursor: not-allowed; }
.btn-primary { color: var(--color-accent); border-color: var(--color-accent); }
.btn-primary:hover { background: color-mix(in srgb, var(--color-accent) 12%, transparent); }
.btn-primary:active { background: color-mix(in srgb, var(--color-accent) 22%, transparent); }
.btn-secondary { border-color: var(--color-divider); }
.btn-secondary:hover { background: color-mix(in srgb, var(--color-text) 7%, transparent); }
.btn-secondary:active { background: color-mix(in srgb, var(--color-text) 14%, transparent); }
.btn-ghost { color: var(--color-accent); padding-inline: var(--space-1); }
.btn-ghost:hover { background: color-mix(in srgb, var(--color-accent) 10%, transparent); }
.btn-ghost:active { background: color-mix(in srgb, var(--color-accent) 18%, transparent); }
.btn-icon { width: 36px; height: 36px; padding: 0; }
.btn-block { width: 100%; margin-top: var(--space-2); }
```

### .field e .input

```css
.field > label {
  display: block; font-size: 12px; margin-bottom: 5px;
  color: color-mix(in srgb, var(--color-text) 70%, transparent);
}
.input {
  width: 100%; min-height: 36px; padding: 6px 10px; font: inherit;
  font-size: 14px; color: var(--color-text); caret-color: var(--color-accent);
  background: var(--color-surface);
  border: 1px solid var(--color-divider); border-radius: var(--radius-md);
}
.input:hover { border-color: color-mix(in srgb, var(--color-text) 45%, transparent); }
.input:focus-visible { border-color: var(--color-accent); outline-offset: 0; }
textarea.input { min-height: 90px; resize: vertical; }
```

### .seg / .seg-opt

```css
.seg {
  display: inline-flex; overflow: hidden;
  border: 1px solid var(--color-divider); border-radius: var(--radius-md);
}
.seg-opt {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 7px 12px; font-size: 13px; cursor: pointer;
}
.seg-opt + .seg-opt { border-left: 1px solid var(--color-divider); }
.seg-opt:has(input:checked) { color: var(--color-accent); box-shadow: inset 0 0 0 1px var(--color-accent); }
.seg-opt:not(:has(input:checked)):hover { background: color-mix(in srgb, var(--color-text) 7%, transparent); }
.seg-opt:has(input:focus-visible) { outline: 2px solid var(--color-accent); outline-offset: -2px; }
```

Uso no protótipo: `<div class="seg" style="display:flex">` + botões `class="seg-opt"` com `style="flex:1; justify-content:center; background:{bg}; color:{color}; border:none; cursor:pointer; white-space:nowrap"`. Estado da opção (função `seg()`): selecionada = `background: var(--color-accent-800)`, `color: var(--color-accent-200)`; não selecionada = `background: transparent`, `color: var(--color-neutral-400)`. Obs.: como os botões têm `border:none` inline, o separador `.seg-opt + .seg-opt { border-left }` é anulado (o inline vence); não há divisória entre opções, só a borda externa do `.seg`.

### Chips (função `chips()`, pílulas de múltipla escolha)

Ícone `ph-check` quando marcado, `ph-plus` quando não. Selecionado: `border: var(--color-accent-600)`, `background: var(--color-accent-900)`, `color: var(--color-accent-200)`. Não selecionado: `border: var(--color-divider)`, `background: transparent`, `color: var(--color-neutral-400)`. Estilo padrão do chip nos drawers: `display:flex; align-items:center; gap:6px; padding:6px 12px; border-radius:999px; border:1px solid ...; cursor:pointer; font-family:var(--font-body); font-size:12px` com ícone `font-size:12px`.

### .card

```css
.card {
  display: flex; flex-direction: column; gap: var(--space-2);   /* 5.6px */
  padding: var(--space-3); border-radius: var(--radius-md); background: var(--color-surface);   /* 8.4px, 8px */
}
.elev-sm { box-shadow: var(--shadow-sm); }
.elev-md { box-shadow: var(--shadow-md); }
.elev-lg { box-shadow: var(--shadow-lg); }
```
(`.card-kicker`, `.card-title`, `.card-body`, `.card-meta` existem no CSS mas não são usadas no PearChat.) O protótipo quase sempre sobrescreve `padding`, `gap` e `border-radius` inline.

### .tag

```css
.tag {
  display: inline-flex; align-items: center; font-size: 11px;
  letter-spacing: 0.02em; padding: 3px 10px;
  border-radius: calc(var(--radius-md) * 0.75);   /* 6px */
}
.tag-accent { background: var(--color-accent-800); color: var(--color-accent-100); }
.tag-accent-2 { background: var(--color-accent-2-800); color: var(--color-accent-2-100); }  /* não usado */
.tag-neutral { background: var(--color-neutral-800); color: var(--color-neutral-100); }
.tag-outline { border: 1px solid var(--color-accent); color: var(--color-accent); }
```

### Outras classes Nocturne (existem, NÃO usadas no PearChat)

`.hr`, `.radio`, `.nav`, `.table`, `.dialog*`, `.lighten`. (`.seg-opt input` / `.radio input` ocultam inputs, mas o protótipo usa botões.)

## 5. Keyframes (CSS literal do protótipo)

```css
@keyframes zfIn     { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }
@keyframes zfToast  { from { opacity: 0; transform: translateY(14px); } to { opacity: 1; transform: none; } }
@keyframes zfPulse  { 0%, 100% { opacity: .45; } 50% { opacity: 1; } }
@keyframes zfDrawer { from { transform: translateX(40px); opacity: 0; } to { transform: none; opacity: 1; } }
@keyframes zfFade   { from { opacity: 0; } to { opacity: 1; } }
@keyframes zfSpin   { to { transform: rotate(360deg); } }
```

(`zfFade` não é citado no README mas existe e é usado no overlay do drawer e nos overlays de "Conectando…".)

Onde cada animação é aplicada (valores literais):

| Local | animation |
|---|---|
| Tela escolha de tipo, cartões de conexão, cartão de QR rápido | `zfIn .35s ease` |
| Cartão Google "Escolher conta" / "Escolher agendas" | `zfIn .3s ease` |
| Cartão Google intro | `zfIn .35s ease` |
| Tela Contatos (corpo), grade da Agenda conectada | `zfIn .3s ease` |
| Painel "Novo contato" | `zfIn .25s ease` |
| Grade conversas (lista+chat) | `zfIn .35s ease` |
| Bolha de mensagem | `zfIn .25s ease` |
| Resposta do "Testar o agente" | `zfIn .25s ease` |
| Item de campanha | `zfIn .25s ease` |
| Evento do dia (drawer agenda) | `zfIn .2s ease` |
| Ponto de status do WhatsApp (sidebar) | `zfPulse 2.4s infinite` |
| Ponto "O código expira em 2 minutos" / status do QR rápido | `zfPulse 1.8s infinite` |
| Bolha "{nome} está digitando…" | `zfPulse 1.2s infinite` |
| Overlay "Confirmando com a Meta…", "Conectando…", "Conectando com o Google…" | `zfFade .2s ease` |
| Spinner (30×30; `border:2px solid var(--color-accent-700); border-top-color:var(--color-accent-400); border-radius:999px`) | `zfSpin .8s linear infinite` |
| Fundo escuro do drawer (overlay) | `zfFade .2s ease` |
| Painel do drawer | `zfDrawer .28s ease` |
| Toast | `zfToast .28s ease` |
| Barra de progresso de campanha | `transition: width .4s ease` |

## 6. Switch (toggle)

Três tamanhos. Todos: botão `padding:0; border-radius:999px; border:1px solid ...; position:relative; cursor:pointer` + `<span>` knob `position:absolute; top:2px; border-radius:999px`.

| Onde | Track | Knob | left off / on | Transições |
|---|---|---|---|---|
| Menu lateral | 38×22 | 16×16 | `2px` / `18px` | track: `background .2s, border-color .2s`; knob: `left .18s ease, background .2s` |
| Cabeçalho do drawer | 42×24 | 18×18 | `2px` / `20px` | track: `background .2s`; knob: `left .18s ease` |
| Agenda (barra superior, "IA pode agendar") | 34×20 | 14×14 | `2px` / `16px` | track: `background .2s`; knob: `left .18s ease` |

Cores (todas via tokens):
- Ligado: track `background: var(--color-accent-500)` `border-color: var(--color-accent-400)`; knob `#fbfcf3`.
- Desligado: track `background: var(--color-neutral-900)` `border-color: var(--color-neutral-700)`; knob `var(--color-neutral-500)`.

Resolvido: no menu lateral (escuro) ligado = `#a8c23a` / borda `#bcd35a`; desligado = `#262b1f` / borda `#4a5240` / knob `#8a927d`. No drawer e na barra da Agenda (claro) ligado = `#a8c23a` / borda `#86a028`; desligado = `#eff1e6` / borda `#c9cfb8` / knob `#727a63`.

Variante **bloqueada** (menu lateral, sem WhatsApp): em vez do switch, botão 38×22, `padding:0; border-radius:999px; border:1px dashed var(--color-neutral-700); background:transparent; display:grid; place-items:center; cursor:pointer`, `title="Conecte o WhatsApp para ligar"`, ícone `ph ph-lock-simple` `font-size:12px; color: var(--color-neutral-500)`.

No drawer, o switch só aparece se `df.showToggle` (WhatsApp conectado); sem conexão aparece a pílula "Bloqueado" (ver 04-drawers.md).

## 7. Toast (CSS literal)

```html
<div style="position:fixed; right:22px; bottom:22px; z-index:60; animation:zfToast .28s ease">
  <div class="card elev-lg" style="padding:12px 15px; display:flex; align-items:center; gap:11px; border-color:var(--color-accent-700); max-width:380px">
    <i class="ph-fill {icon}" style="font-size:18px; color:var(--color-accent-400)"></i>
    <div>
      <div style="font:500 12.5px/1.2 var(--font-heading)">{titulo}</div>
      <div style="font-size:11.5px; color:var(--color-neutral-500); margin-top:3px">{texto}</div>
    </div>
  </div>
</div>
```

Observações:
- Ícone sempre `ph-fill` + nome (`ph-check-circle` por padrão se não informado).
- `.card` aplica `background: var(--color-surface)` (branco, tema claro). `border-color` sozinho não cria borda (sem `border-style`); a "borda" visível vem do ring do `--shadow-lg` (`0 0 0 1px #9397ab`). Ou seja, na prática a cor `accent-700` não aparece.
- Duração: 3800 ms (`setTimeout`), timer anterior é cancelado a cada novo toast (só 1 toast por vez, sem fila).
- Fica dentro de `<main>`; `position:fixed` relativo à janela.

## 8. Overlay e drawer (CSS literal)

```html
<!-- overlay -->
<div onClick="fecharDrawer" style="position:fixed; inset:0; z-index:40; background:color-mix(in srgb, #1d2117 30%, transparent); animation:zfFade .2s ease"></div>
<!-- painel -->
<div style="position:fixed; top:0; right:0; bottom:0; z-index:41; width:min(540px, 94vw); display:flex; flex-direction:column; background:var(--color-surface); border-left:1px solid var(--color-divider); box-shadow:-24px 0 60px color-mix(in srgb, #1d2117 16%, transparent); animation:zfDrawer .28s ease">
  <!-- cabeçalho --> padding:18px 22px; display:flex; align-items:center; gap:13px; border-bottom:1px solid var(--color-divider)
  <!-- corpo -->      flex:1; min-height:0; overflow-y:auto; padding:22px; display:flex; flex-direction:column; gap:24px
  <!-- rodapé -->     padding:14px 22px; border-top:1px solid var(--color-divider); display:flex; gap:10px; justify-content:flex-end; align-items:center
</div>
```

Z-index: overlay 40, painel 41, toast 60. Esc em qualquer momento fecha o drawer (listener global `keydown` em `window`).

Ícone do cabeçalho do drawer: caixa 40×40 `border-radius:11px; background:var(--color-accent-900); border:1px solid var(--color-accent-700)`, ícone `font-size:19px; color:var(--color-accent-300)`. Título `font:500 16px/1.2 var(--font-heading)`; descrição `font-size:12px; color:var(--color-neutral-500); margin-top:3px`. Botão ✕: `class="btn btn-ghost btn-icon"` 34×34, ícone `ph ph-x` 16px.

## 9. Tipografia recorrente

- Corpo do app: Inter 400, 13.5px (wrapper).
- Títulos: `font:500 {tam}px/{lh} var(--font-heading)`; letter-spacing `-.02em` nos grandes (26/30px), `-.01em` na marca.
- Rótulo de seção em caixa alta (drawer): `font:500 11px/1 var(--font-heading); letter-spacing:.12em; text-transform:uppercase; color:var(--color-neutral-500)`.
- Rótulo de seção do menu lateral ("Automações", "Agenda"): `font:500 10.5px/1 var(--font-heading); letter-spacing:.14em; text-transform:uppercase; color:var(--color-neutral-500)`.
- Kicker de telas de conexão: `font:500 10.5px/1 var(--font-heading); letter-spacing:.16em; text-transform:uppercase; color:var(--color-accent-300)`.
- `text-wrap: pretty` em vários parágrafos.
- Hover inline: o runtime usa o atributo `style-hover="..."` (não é CSS padrão; em React recriar com `:hover`).

## 10. Padrões repetidos

- **Pílula de filtro** (conversas/contatos): `padding:5px 11px; border-radius:999px; border:1px solid ...; font-size:12px; white-space:nowrap`. Ativa: `bg accent-900`, `border accent-600`, `color accent-200`. Inativa: `bg transparent`, `border divider`, `color neutral-400`.
- **Opção em rádio (listas, histórico, modelos)**: botão `padding:12px 14px; border-radius:var(--radius-md); border:1px solid ...`, bolinha 16×16 `border-radius:999px; border:1px solid {dotBorder}` com miolo 8×8 `{dotFill}`. Selecionado: `border accent-600`, `bg accent-900`, `dotBorder accent-400`, `dotFill accent-400`. Não selecionado: `border divider`, `bg transparent`, `dotBorder neutral-700`, `dotFill transparent`.
- **Barra de progresso**: trilho `height:6px; border-radius:999px; background:var(--color-neutral-900)` (ou `--color-surface` dentro de bloco accent-900), preenchimento `height:100%; border-radius:999px; background:linear-gradient(90deg, var(--color-accent-600), var(--color-accent-400))`.
- **Fundo de telas de conexão/agenda off**: `background:radial-gradient(900px 480px at 30% 0%, var(--color-accent-900), transparent 70%), var(--color-bg)`.
- **Fundo da área de mensagens**: `background:radial-gradient(700px 360px at 60% 0%, var(--color-accent-900), transparent 70%), var(--color-bg)`.
