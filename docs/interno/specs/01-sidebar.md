# 01 - Menu lateral (sidebar)

Tema escuro "pera" (tokens do wrapper; ver 00). Fonte: `<aside>` do HTML (linhas 34-153) e `renderVals()`.

## Container

```css
aside {
  width:288px; flex:0 0 auto; display:flex; flex-direction:column;
  overflow-y:auto; overflow-x:hidden;
  border-right:1px solid var(--color-divider);                    /* #2e3426 */
  background:linear-gradient(180deg, var(--color-accent-900) 0%, var(--color-bg) 40%);  /* #1f2512 -> #14170f */
}
```
Rola verticalmente quando não cabe. O wrapper pai tem `height:100vh; overflow:hidden`.

## Ordem dos blocos (de cima para baixo)

### 1. Marca (60px)
```
height:60px; flex:0 0 auto; display:flex; align-items:center; gap:10px; padding:0 18px
```
- Ícone: caixa 28×28 `border-radius:8px; border:1px solid var(--color-accent-600); background:var(--color-accent-900); box-shadow:0 0 16px var(--color-accent-900); display:grid; place-items:center`, contendo `<i class="ph-fill ph-leaf">` `font-size:15px; color:var(--color-accent-300)`. (O README diz "ícone de pera", o HTML usa o ícone Phosphor `ph-leaf`.)
- Texto: `Pear` + `<span style="color:var(--color-accent-400)">Chat</span>`, estilo `font:500 18px/1 var(--font-heading); letter-spacing:-.01em`. Texto exato: **PearChat** (Pear branco, Chat em `#bcd35a`).
- Sem ação de clique.

### 2. Cartão do WhatsApp
Wrapper `padding:6px 16px 0`. Botão (clique: `irWhatsapp` -> `view='whatsapp'`, `drawer=null`):
```
width:100%; border:1px solid {waBorder}; border-radius:var(--radius-lg) /*14px*/; padding:13px;
background:var(--color-surface) /*#1d2117*/; display:flex; align-items:center; gap:11px;
color:var(--color-text); cursor:pointer; text-align:left; font-family:var(--font-body)
hover: border-color:var(--color-accent-600)   /* #6a8226 */
```
- `waBorder`: `var(--color-accent-700)` quando `view==='whatsapp'`; senão `var(--color-divider)`.
- Avatar: 36×36 `border-radius:999px; background:var(--color-accent-900); border:1px solid var(--color-accent-700)`, ícone `ph ph-whatsapp-logo` 18px `var(--color-accent-300)`.
- Texto (flex:1): título `font:500 13px/1.25 var(--font-heading)` e subtítulo `font-size:11.5px; color:var(--color-neutral-400); margin-top:2px`, ambos `white-space:nowrap; overflow:hidden; text-overflow:ellipsis`.
- Ponto de status: 8×8 `border-radius:999px; background:{connDot}; animation:zfPulse 2.4s infinite`.

Textos por estado:

| Estado | Título (`connTitulo`) | Subtítulo (`connSub`) | Ponto |
|---|---|---|---|
| Desconectado | `WhatsApp desconectado` | `Escaneie o QR para começar` | `var(--color-neutral-600)` (`#69725d`) |
| Conectado, provider `'oficial'` | `WhatsApp conectado` | `Oficial · {ofNumero}` (padrão `+55 11 98765-4321`; é o texto digitado no passo "número") | `var(--color-accent-400)` (`#bcd35a`) |
| Conectado, qualquer outro provider (`'rapida'` ou `null` via prop `iniciarConectado`) | `WhatsApp conectado` | `Conexão rápida · +55 11 98765-4321` (número fixo no código) | idem |

### 3. Cabeçalho "Automações"
`padding:22px 18px 10px; display:flex; align-items:baseline; justify-content:space-between`.
- Esquerda: `Automações` (`font:500 10.5px/1 var(--font-heading); letter-spacing:.14em; text-transform:uppercase; color:var(--color-neutral-500)`).
- Direita: contador `font-size:11px; color:var(--color-neutral-500)`. Texto: `{N} de 3 ligadas` onde N = quantidade de automações com `on` (ia, disparos, followup). **Vazio quando desconectado.** Com os dados iniciais conectados (iaOn=false, dispOn=true, fuOn=false) mostra `1 de 3 ligadas`.

### 4. Linhas de automação (3)
Container: `padding:0 16px; display:flex; flex-direction:column; gap:8px`.

Linha (div):
```
display:flex; align-items:center; gap:10px; padding:11px 12px; border-radius:var(--radius-lg);
border:1px solid {border}; background:{bg}; transition:background .2s, border-color .2s
```
Dentro: um botão grande (abre drawer) + o switch (ou cadeado) à direita.

Botão de abrir: `flex:1; min-width:0; display:flex; align-items:center; gap:11px; background:none; border:none; padding:0; color:var(--color-text); text-align:left; cursor:pointer`.
- Ícone: 34×34 `border-radius:9px; background:{iconBg}; transition:background .2s`, `<i class="ph {icon}">` `font-size:17px; color:{iconColor}`.
- Título: `font:500 13px/1.25 var(--font-heading); white-space:nowrap; overflow:hidden; text-overflow:ellipsis`.
- Etiqueta "Novo" (somente Follow-up): `<span class="tag tag-outline" style="font-size:9px; padding:1px 5px; flex:0 0 auto">Novo</span>`.
- Subtítulo: `display:block; font-size:11px; color:{subColor}; margin-top:3px; ellipsis`.

Ação do clique no botão: `drawer = f.id` (`'ia'`, `'disparos'` ou `'followup'`) e `testA = null` (limpa a resposta do "Testar o agente"). Funciona conectado ou não.

Definição das três:

| id | Título | Ícone | Descrição (cabeçalho do drawer) | Subtítulo ligado | Subtítulo desligado |
|---|---|---|---|---|---|
| `ia` | `Agentes de IA` | `ph-sparkle` | `Responde seus clientes com as suas instruções` | `{agente.nome} está respondendo` (ex.: `Luna está respondendo`) | `Desligado · toque para configurar` |
| `disparos` | `Disparos automáticos` | `ph-paper-plane-tilt` | `Envie mensagens para contatos e listas` | ver abaixo | `Pausado` |
| `followup` | `Follow-up automático` (com tag `Novo`) | `ph-clock-clockwise` | `Retoma conversas de quem parou de responder` | `{fuFila.length} contatos na fila` (ex.: `3 contatos na fila`) | `Desligado · toque para configurar` |

Subtítulo de Disparos (avaliado nesta ordem, `on` = `dispOn`):
1. se existe campanha com `status==='Enviando'`: `Enviando · {enviadas}/{total}` (números sem separador de milhar, ex.: `Enviando · 24/312`);
2. senão, se `!dispOn`: `Pausado`;
3. senão, se há campanhas `Agendada`: `{n} campanha agendada` (sem plural, mesmo com n>1);
4. senão: `Pronto para enviar`.
Observação: a ordem faz o subtítulo mostrar `Enviando · x/y` mesmo se o usuário pausar os disparos durante o envio.

Estados visuais (resolvidos no escuro):

| | Ligada (`on`) | Desligada |
|---|---|---|
| `border` | `var(--color-accent-700)` `#41511e` | `var(--color-divider)` `#2e3426` |
| `bg` | `color-mix(in srgb, var(--color-accent) 12%, var(--color-surface))` | `var(--color-surface)` |
| `iconBg` | `var(--color-accent-800)` `#2c3617` | `var(--color-neutral-900)` `#262b1f` |
| `iconColor` | `var(--color-accent-200)` `#e0eba6` | `var(--color-neutral-400)` `#a9b09d` |
| `subColor` | `var(--color-accent-300)` `#cfe07e` | `var(--color-neutral-500)` `#8a927d` |

**Estado bloqueado (WhatsApp desconectado)**: todas as três são forçadas para `on=false`, subtítulo `Bloqueado · toque para ver`, e em vez do switch aparece o botão tracejado com cadeado 38×22 (ver 00, seção 6) com `title="Conecte o WhatsApp para ligar"`. Clicar no cadeado: toast `Conecte o WhatsApp primeiro` / `Depois disso você pode ligar {titulo da automação}` (ícone `ph-lock-simple`). A linha continua abrindo o drawer.

**Switch (conectado)**: `<button aria-label="{titulo}">` 38×22, ver 00 seção 6. Clique chama `toggleIa()`, `toggleDisp()` ou `toggleFu()` (ver 03-conversas.md e 06-toasts-e-regras.md para os toasts e efeitos).

Nota: existem `featOpacity` e `featPointer` calculados no código (0.45 / 'none' quando desconectado) mas **não são usados** no markup.

### 5. Aviso de bloqueio
Só quando `!connected`. `padding:12px 20px 0; font-size:11.5px; color:var(--color-neutral-500); text-wrap:pretty; display:flex; gap:7px`. Ícone `ph ph-lock-simple` `font-size:13px; flex:0 0 auto; margin-top:1px`. Texto exato:

> Você já pode ver e configurar. Para ligar, conecte o WhatsApp.

### 6. Bloco Agenda
Wrapper `padding:20px 16px 0`. Rótulo `Agenda` (mesmo estilo do "Automações", `padding:0 2px 10px`).

Botão (clique: `abrirAgenda` -> `view='agenda'`, `drawer=null`):
```
width:100%; position:relative; overflow:hidden; display:flex; align-items:center; gap:13px; padding:12px 13px;
border-radius:var(--radius-lg); border:1px solid {agBtnBorder}; 
background:linear-gradient(135deg, color-mix(in srgb, var(--color-accent) 26%, var(--color-surface)) 0%, var(--color-surface) 70%);
box-shadow:{agBtnGlow}; color:var(--color-text); cursor:pointer; text-align:left; transition:border-color .2s, box-shadow .2s
hover: border-color:var(--color-accent-500); box-shadow:0 0 0 1px var(--color-accent-700), 0 8px 24px color-mix(in srgb, var(--color-accent) 22%, transparent)
```
- `agBtnBorder`: `view==='agenda'` ? `var(--color-accent-500)` : `var(--color-accent-700)`.
- `agBtnGlow`: `view==='agenda'` ? `0 0 0 1px var(--color-accent-600), 0 8px 26px color-mix(in srgb, var(--color-accent) 26%, transparent)` : `none`.
- Brilho decorativo: `position:absolute; right:-18px; top:-18px; width:74px; height:74px; border-radius:999px; background:radial-gradient(circle, color-mix(in srgb, var(--color-accent) 35%, transparent), transparent 70%)`.
- Mini-calendário: 46×50, `border-radius:10px; overflow:hidden; border:1px solid var(--color-accent-600); background:var(--color-bg); display:flex; flex-direction:column`. Topo `height:15px; background:var(--color-accent-500); color:var(--color-accent-900); font:600 9px/15px var(--font-heading); letter-spacing:.14em; text-align:center` com o texto **OUT**. Corpo `flex:1; display:grid; place-items:center; font:500 20px/1 var(--font-heading); color:var(--color-text)` com o texto **2**. (Ambos fixos/hard-coded; "hoje" = sexta 2 de outubro de 2026.)
- Texto: título `Agenda` (`font:500 14px/1.2 var(--font-heading)`); subtítulo `display:flex; align-items:center; gap:6px; margin-top:4px; font-size:11.5px; color:var(--color-accent-300)` com ícone 12px antes.
  - Agenda NÃO conectada (`gOn=false`): ícone `ph-google-logo`, texto `Conectar Google Agenda`.
  - Conectada: ícone `ph-clock`; se há eventos hoje (`dia===0`): `{N} hoje · próximo {HH:MM}` onde HH:MM é o horário do primeiro evento do dia por ordem crescente de hora (com os dados iniciais: `3 hoje · próximo 09:30`); senão `Nada marcado hoje`. ("próximo" é simplesmente o mais cedo do dia; não compara com a hora atual.)
- Seta à direita: 26×26 `border-radius:999px; border:1px solid var(--color-accent-700)`, ícone `ph ph-arrow-right` 12px `var(--color-accent-300)`.

### 7. Bloco Contatos
Wrapper `padding:10px 16px 0`. Botão (clique: `abrirContatos` -> `view='contatos'`, `drawer=null`):
```
width:100%; display:flex; align-items:center; gap:13px; padding:12px 13px; border-radius:var(--radius-lg);
border:1px solid {ctBtnBorder}; background:{ctBtnBg}; color:var(--color-text); cursor:pointer; text-align:left; transition:border-color .2s, background .2s
hover: border-color:var(--color-accent-600)
```
- `view==='contatos'`: border `var(--color-accent-500)`, bg `color-mix(in srgb, var(--color-accent) 14%, var(--color-surface))`. Caso contrário: border `var(--color-divider)`, bg `var(--color-surface)`.
- Ícone: 46×46 `border-radius:12px; border:1px solid var(--color-accent-700); background:var(--color-bg); position:relative`, com `ph ph-address-book` 21px `var(--color-accent-300)`; selo de nuvem `position:absolute; right:-5px; bottom:-5px; width:20px; height:20px; border-radius:999px; background:var(--color-accent-500); border:2px solid var(--color-bg)` contendo `ph-fill ph-cloud-check` 10px `var(--color-accent-900)`.
- Título `Contatos` (`font:500 14px/1.2`), subtítulo `{(contatos.length + ctExtra)} salvos na nuvem` (`font-size:11.5px; color:var(--color-neutral-400)`; formatado pt-BR; inicial `1.248 salvos na nuvem` = 10 + 1238; sobe 1 a cada contato novo salvo).
- Seta `ph ph-caret-right` 13px `var(--color-neutral-500)`.

### 8. Espaçador
`<div style="flex:1 0 16px"></div>` (empurra a conta para baixo; mínimo 16px).

### 9. Navegação de conta
Wrapper `padding:12px 16px 4px; border-top:1px solid var(--color-divider); display:flex; flex-direction:column; gap:2px`. Dois botões:
```
width:100%; display:flex; align-items:center; gap:11px; padding:8px 10px; border:none; border-radius:var(--radius-md);
background:{bg}; color:{color}; cursor:pointer; text-align:left; font-size:13px
hover: background:var(--color-neutral-900)
```
- Ícone `ph {icon}` 16px; rótulo `flex:1`; etiqueta opcional `<span class="tag tag-accent" style="font-size:10px">`.
- Item ativo (o drawer correspondente aberto): `bg var(--color-accent-900)`, `color var(--color-accent-200)`; inativo: `bg transparent`, `color var(--color-neutral-300)`.

| Rótulo | Ícone | Tag | Clique |
|---|---|---|---|
| `Configurações` | `ph-gear-six` | (vazia) | `drawer='config'` |
| `Plano e pagamento` | `ph-crown-simple` | nome do plano atual (padrão `Pro`) | `drawer='plano'` |

### 10. Rodapé do usuário
`padding:8px 16px 16px; display:flex; align-items:center; gap:10px`.
- `<input type="file" accept="image/*" style="display:none">` (ref `fotoRef`) com `onChange` = `onFoto`.
- Botão-foto (`title="Trocar foto"`; clique abre seletor de arquivo): 36×36 `position:relative; padding:0; border-radius:999px; border:1px solid var(--color-accent-700); background:var(--color-accent-800); color:var(--color-accent-200); overflow:visible; display:grid; place-items:center; font:500 12px/1 var(--font-heading)`; hover `border-color:var(--color-accent-400)`.
  - Com foto: `<span>` 100%×100% `border-radius:999px; background-image:url(<dataURL>); background-size:cover; background-position:center`.
  - Sem foto: iniciais (`cfgSigla`) = 1ª letra do 1º nome + 1ª letra do 2º nome (padrão `MC`; sem uppercase forçado: usa as letras como digitadas).
  - Selo de câmera: `position:absolute; right:-3px; bottom:-3px; width:16px; height:16px; border-radius:999px; background:var(--color-accent-500); border:2px solid var(--color-bg)` com `ph-fill ph-camera` 8px `var(--color-accent-900)`.
- Ao escolher arquivo: lê via `FileReader.readAsDataURL`, grava `cfgFoto`, e dispara toast `Foto atualizada` / `Seu perfil já mostra a nova foto` (ícone `ph-camera`). Zera `e.target.value` depois.
- Bloco de texto: nome `cfg.nome` (`font:500 12.5px/1.25 var(--font-heading)`, ellipsis; padrão `Mariana Costa`) e linha `cfg.empresa · Plano {plano}` (`font-size:11px; color:var(--color-neutral-500)`, ellipsis; padrão `Doce Ateliê · Plano Pro`).
- Botão sair (só se `connected`): `class="btn btn-ghost btn-icon"` 32×32, `title="Desconectar WhatsApp"`, ícone `ph ph-sign-out` 15px. Clique: `desconectar()`:
  - `connected=false, iaOn=false, fuOn=false, drawer=null, provider=null, ofStep='numero'`;
  - toast `WhatsApp desconectado` / `As automações foram desligadas` (ícone `ph-plugs`).
  - Nota: `dispOn` NÃO é alterado (continua `true` internamente, mas a UI mostra tudo bloqueado); `view` não muda (se estiver em Agenda/Contatos, permanece); conversas, `agente`, campanhas e demais estados permanecem.

## Resumo de estados

| Estado | Efeito no menu |
|---|---|
| WhatsApp desconectado | Cartão cinza `WhatsApp desconectado`; contador "N de 3 ligadas" vazio; 3 linhas bloqueadas (cadeado tracejado, `Bloqueado · toque para ver`); aviso `Você já pode ver e configurar...`; sem botão sair |
| Conectado, nenhuma ligada | Cartão `WhatsApp conectado`; switches desligados (menos Disparos, que inicia `dispOn=true`) |
| IA ligada | Linha IA destacada, sub `Luna está respondendo`, chip `Luna ativa` na barra de conversas |
| Agenda conectada vs não | Subtítulo do botão muda (ver bloco 6); `view==='agenda'` destaca a borda/brilho |

## Props do componente
`iniciarConectado` (boolean, padrão `false`, seção "Demonstração"): se `true`, no `componentDidMount` faz `connected=true` sem alterar `provider` (fica `null`, tratado como "Conexão rápida").
