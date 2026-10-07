# 03 - Tela de Conversas (`view='whatsapp'` e `connected=true`)

Fonte: HTML linhas 685-785 e lógica (`toggleIa`, `enviar`, `chatList`, `ac`, `msgs`, `REPLIES`). Tema CLARO. Condição de exibição: `showWa = view==='whatsapp' && connected`.

Estado: `chats[]`, `ativa` (padrão `'c1'`), `filtro` (`'todas' | 'nao_lidas' | 'ia'`, padrão `'todas'`), `busca` (padrão `''`), `draft` (padrão `''`), `iaOn` (padrão `false`), `agente`.

## 1. Barra superior (56px)

```
height:56px; flex:0 0 auto; display:flex; align-items:center; gap:14px; padding:0 20px;
border-bottom:1px solid var(--color-divider); background:var(--color-surface)
```
- Esquerda: título `WhatsApp` (`font:500 14.5px/1.2 var(--font-heading)`) e subtítulo `Doce Ateliê · +55 11 98765-4321` (`font-size:11px; color:var(--color-neutral-500)`). **Ambos fixos no HTML** (não usam `cfg.empresa` nem `ofNumero`).
- Espaçador `flex:1`.
- À direita, chips de automação ligada: container `display:flex; gap:7px; flex-wrap:wrap; justify-content:flex-end`. Cada chip é `<button class="tag tag-accent" style="display:flex; align-items:center; gap:5px; cursor:pointer; border:none">` com ícone `ph {icon}` 12px + rótulo. Clique abre o drawer da automação (mesmo `open` da sidebar: `drawer=id`, `testA=null`).
  - Só aparecem automações com `on=true` (na ordem ia, disparos, followup). Sem nenhuma ligada, não há chips.
  - Rótulos: IA = `{agente.nome} ativa` (ex.: `Luna ativa`, ícone `ph-sparkle`); Disparos = `Disparos automáticos` (ícone `ph-paper-plane-tilt`); Follow-up = `Follow-up automático` (ícone `ph-clock-clockwise`).
  - Com o estado inicial conectado (dispOn=true) aparece apenas o chip `Disparos automáticos`.
  - Cores do `tag-accent` no tema claro: fundo `#e6efc3`, texto `#3a4711`.

## 2. Grade principal

```
flex:1; min-height:0; display:grid; grid-template-columns:minmax(260px, 330px) minmax(0, 1fr); animation:zfIn .35s ease
```

### 2.1 Coluna esquerda - lista de conversas
Container: `display:flex; flex-direction:column; min-height:0; background:var(--color-surface); border-right:1px solid var(--color-divider)`.

Topo (`padding:14px 14px 10px; display:flex; flex-direction:column; gap:10px`):
- Busca: wrapper `position:relative`; ícone `ph ph-magnifying-glass` (`position:absolute; left:11px; top:50%; transform:translateY(-50%); font-size:14px; color:var(--color-neutral-500)`); `<input class="input" placeholder="Buscar conversa" style="width:100%; padding-left:32px">`. Filtra por `nome` (case-insensitive, `indexOf`), apenas pelo nome (não pelo telefone nem pelo texto).
- Filtros (pílulas, `display:flex; gap:6px`), nesta ordem: `Todas` (`todas`), `Não lidas` (`nao_lidas`), `Com IA` (`ia`). Estilo da pílula: ver 00 seção 10 (`padding:5px 11px`, 12px).
  - `nao_lidas`: `unread > 0`.
  - `ia`: `mode === 'ia'` (independe de `iaOn`).
  - A busca e o filtro se combinam.

Lista: `flex:1; min-height:0; overflow-y:auto`. Ordem fixa (a de `chats[]`; não reordena por atividade). Sem estado vazio no protótipo (lista em branco se nada casar).

Item (botão):
```
width:100%; display:flex; gap:12px; align-items:center; padding:12px 14px; border:none; border-top:1px solid var(--color-divider);
background:{bg}; box-shadow:{ring}; color:var(--color-text); cursor:pointer; text-align:left
hover: background:var(--color-neutral-900)      /* #eff1e6 */
```
- Ativo: `bg var(--color-accent-900)` (`#f3f7e2`) e `ring: inset 3px 0 0 var(--color-accent-500)`; inativo: `bg transparent`, `ring none`.
- Avatar: `position:relative; width:42px; height:42px; border-radius:999px; background:var(--color-neutral-900); color:var(--color-accent-200); display:grid; place-items:center; font:500 13px/1 var(--font-heading)` com as iniciais (`sigla`).
- Selo de IA (se `mode==='ia' && iaOn`): `position:absolute; right:-2px; bottom:-2px; width:18px; height:18px; border-radius:999px; background:var(--color-accent-400); border:2px solid var(--color-surface)` com `ph-fill ph-sparkle` 9px `#fbfcf3`. (O README fala em "selo ✦"; no HTML é o ícone Phosphor sparkle, não o caractere.)
- Linha 1: nome (`font:500 13.5px/1.25 var(--font-heading); flex:1; ellipsis`) + hora da última mensagem (`font-size:10.5px; flex:0 0 auto`; cor `accent-300` se há não lidas, senão `neutral-500`).
- Linha 2 (`margin-top:4px`): prévia (`font-size:12px; flex:1; ellipsis`) + contador.
  - Prévia = prefixo + texto da última mensagem. Prefixo: `Você: ` se `from==='eu'`; `{agente.nome}: ` (ex.: `Luna: `) se `from==='ia'`; vazio se do cliente. Cor `neutral-500`.
  - Se `typing`: prévia = `{agente.nome} está digitando…` com cor `var(--color-accent-300)`.
  - Contador (se `unread>0`): `min-width:18px; height:18px; padding:0 5px; border-radius:999px; background:var(--color-accent-400); color:#fbfcf3; font:500 10.5px/18px var(--font-heading); text-align:center`.
- Clique: `ativa = id`; **se `!iaOn`** zera `unread` da conversa. Com a IA ligada, abrir a conversa NÃO zera o contador (só a resposta da IA ou o envio do usuário zeram).

### 2.2 Coluna direita - conversa ativa
Container `display:flex; flex-direction:column; min-height:0; min-width:0`. Conversa ativa = `chats.find(id===ativa)` (fallback `chats[0]`).

**Cabeçalho**: `padding:12px 20px; display:flex; align-items:center; gap:12px; border-bottom:1px solid var(--color-divider); background:var(--color-surface); flex-wrap:wrap`.
- Avatar 40×40 (`background:var(--color-neutral-900); color:var(--color-accent-200); font:500 13px/1 var(--font-heading)`), iniciais.
- Nome (`font:500 14.5px/1.25 var(--font-heading)`) e telefone (`font-size:11.5px; color:var(--color-neutral-500); margin-top:2px`) num bloco `flex:1; min-width:160px`.
- **Pílula de modo**: `display:flex; align-items:center; gap:6px; padding:5px 10px; border-radius:999px; border:1px solid {modeBorder}; background:{modeBg}; color:{modeColor}; font-size:11.5px; white-space:nowrap`, ícone 13px.
  Lógica (`isIaMode = iaOn && mode==='ia'`):

  | Condição (avaliada nesta ordem) | Texto exato | Ícone | bg / border / cor |
  |---|---|---|---|
  | `isIaMode` | `{agente.nome} (IA) respondendo` (ex.: `Luna (IA) respondendo`) | `ph-sparkle` | `accent-900` / `accent-700` / `accent-200` |
  | `mode==='humano'` | `Você está atendendo` | `ph-user` | `var(--color-bg)` / `divider` / `neutral-400` |
  | `unread > 0` | `Aguardando resposta` | `ph-clock` | idem |
  | senão | `Conversa aberta` | `ph-clock` | idem |

- Botão **Assumir** (se `isIaMode`): `class="btn btn-primary" style="padding:6px 13px; font-size:12px; white-space:nowrap"`, ícone `ph ph-hand`, texto `Assumir conversa`. Clique: `mode='humano'` + toast `Você assumiu a conversa` / `{agente.nome} pausou para {nome da conversa}` (ícone `ph-hand`).
- Botão **Devolver** (se `iaOn && mode==='humano'`): `class="btn btn-secondary"` mesmo padding/tamanho, ícone `ph ph-sparkle`, texto `Devolver para IA`. Clique: `mode='ia'` + toast `Conversa devolvida` / `{agente.nome} volta a responder {nome da conversa}` (ícone `ph-sparkle`). Não gera resposta automática ao devolver.

**Área de mensagens**: ref `msgsRef`; `flex:1; min-height:0; overflow-y:auto; padding:22px 24px; display:flex; flex-direction:column; gap:10px; background:radial-gradient(700px 360px at 60% 0%, var(--color-accent-900), transparent 70%), var(--color-bg)`. Rola para o fim (`scrollTop = scrollHeight`) em `componentDidMount` e a cada `componentDidUpdate` (qualquer mudança de estado, inclusive toasts).
- Separador de dia fixo: pílula centralizada `align-self:center; font-size:11px; color:var(--color-neutral-500); padding:4px 10px; border-radius:999px; background:var(--color-surface); border:1px solid var(--color-divider)` com o texto `Hoje` (sempre, mesmo para conversas cujas horas são `Ontem`).
- Bolhas: linha `display:flex; justify-content:{align}; animation:zfIn .25s ease`; bolha:
  ```
  max-width:min(560px, 76%); padding:9px 13px 7px; border-radius:{radius}; background:{bg}; border:1px solid {border}
  ```
  - Enviada (`from !== 'cliente'`, ou seja `'eu'` e `'ia'`): `justify-content:flex-end`, `radius 14px 14px 4px 14px`, `bg accent-900` (`#f3f7e2`), `border accent-700` (`#d1e092`).
  - Recebida (`from==='cliente'`): `justify-content:flex-start`, `radius 14px 14px 14px 4px`, `bg var(--color-surface)` (branco), `border var(--color-divider)`.
  - Rótulo da IA (só `from==='ia'`): `display:flex; align-items:center; gap:5px; font:500 10.5px/1 var(--font-heading); color:var(--color-accent-300); margin-bottom:6px`, ícone `ph-fill ph-sparkle` 11px, texto `{agente.nome} · IA` (ex.: `Luna · IA`). (README: "✦ Luna · IA"; o ✦ é o ícone sparkle.) Usa o nome atual do agente, não o da época da mensagem.
  - Texto: `font-size:13px; line-height:1.45; text-wrap:pretty`. Hora: `font-size:10px; color:var(--color-neutral-500); margin-top:4px; text-align:right`.
- Indicador "digitando" (se `typing` da conversa ativa): alinhado à direita, bolha `padding:9px 13px; border-radius:14px 14px 4px 14px; background:var(--color-accent-900); border:1px solid var(--color-accent-700); font-size:12px; color:var(--color-accent-300); display:flex; align-items:center; gap:6px; animation:zfPulse 1.2s infinite`, ícone `ph-fill ph-sparkle` 11px, texto `{agente.nome} está digitando…` (`Luna está digitando…`).

**Campo de envio**: `padding:12px 16px; border-top:1px solid var(--color-divider); background:var(--color-surface); display:flex; gap:10px; align-items:center`.
- Botão anexar: `class="btn btn-ghost btn-icon" title="Anexar"` 36×36, ícone `ph ph-paperclip` 17px. **Sem ação** no protótipo.
- `<input class="input" style="flex:1; min-width:0">` valor `draft`. Placeholder: `Escreva para assumir a conversa` quando `isIaMode`; senão `Digite uma mensagem`.
- Botão `class="btn btn-primary" style="padding:8px 14px"` ícone `ph ph-paper-plane-right`, texto `Enviar`.
- Enter (`e.key==='Enter'`, sem tratar Shift) chama `enviar()`.

## 3. Envio (`enviar()`)

1. `t = draft.trim()`; se vazio, retorna (sem toast).
2. `tomou = iaOn && conversa.mode==='ia'`.
3. Se `provider==='oficial'`: `svcUsed += 1` (medidor de mensagens de atendimento Meta no drawer Plano).
4. Atualiza a conversa: `unread = 0`; `mode = iaOn ? 'humano' : modeAtual`; acrescenta `{from:'eu', texto:t, hora: HH:MM atual (24h, zero à esquerda)}`.
5. Limpa `draft`.
6. Se `tomou`: toast `Você assumiu a conversa` / `{agente.nome} pausou para {nome}` (ícone `ph-hand`).

Observações:
- **A conversa só vira `'humano'` quando `iaOn` é verdadeiro.** Com a IA desligada, enviar não altera o modo (README diz que enviar sempre muda para humano; divergência).
- Se `iaOn` e o modo era `null`, vira `'humano'` sem toast.
- Não há resposta simulada do cliente após enviar; o único "contato" simulado vem da IA ao ligar o agente.
- Não há indicação de status de entrega (ticks).

## 4. Ligar o agente de IA (`toggleIa()`)

Chamado pelo switch da sidebar ou do drawer (somente se `connected`).

- Inverte `iaOn`.
- **Desligar**: toast `Agente de IA desligado` / `Novas conversas ficam com você` (ícone `ph-pause-circle`). Nenhuma conversa muda de modo.
- **Ligar**: calcula `pend` = conversas com `unread > 0` E `mode !== 'humano'` E que tenham texto em `REPLIES` (ou seja, ids `c1, c2, c3, c4, c6`).
  - Sem pendentes: toast `Agente de IA ligado` / `{nome} vai responder as próximas conversas` (ícone `ph-sparkle`).
  - Com pendentes (n): toast `Agente de IA ligado` / `{nome} está respondendo {n} conversas pendentes` (ícone `ph-sparkle`; sem singular, ex. `1 conversas pendentes`). Com os dados iniciais n = 5 (c1 com 2 não lidas, c2, c3 [que já estava `mode:'ia'`], c4, c6).
  - Para cada pendente na posição `i` (ordem de `chats[]`):
    - em **500 + i*1200 ms**: se `iaOn` ainda é true, marca `typing=true` (mostra `Luna está digitando…` no preview e na conversa ativa);
    - em **1500 + i*1200 ms** (ou seja, ~1000 ms de "digitando", intervalo de 1200 ms entre conversas): se `iaOn` foi desligada, apenas limpa `typing`; senão faz `typing=false`, `unread=0`, `mode='ia'` e acrescenta `{from:'ia', texto: REPLIES[id], hora: HH:MM atual}`;
    - ao responder a ÚLTIMA da lista (`i === n-1`), toast `{nome} respondeu {n} conversas` / `Você pode assumir qualquer uma a qualquer momento` (ícone `ph-sparkle`).
  - Os timers não verificam se, enquanto isso, o usuário assumiu a conversa (a resposta ainda é inserida e o modo vira `'ia'`).

### Respostas fixas da IA (`REPLIES`, texto literal)

| Conversa | Texto |
|---|---|
| `c1` Ana Paula Ribeiro | `Oi, Ana! Fazemos sim. Para 40 pessoas sugerimos 45 potes de 200 ml, nos sabores ninho com morango, brigadeiro e red velvet. Sai por R$ 9,50 cada. A festa é dia 18 de qual mês?` |
| `c2` Carlos Menezes | `Olá, Carlos! O bolo de 2 kg de ninho com morango custa R$ 189. Pedimos 48 horas de antecedência. Quer que eu reserve uma data?` |
| `c3` Juliana Freitas | `Combinado, Juliana! Sábado entre 9h e 11h. Me confirma o sabor e o tamanho do bolo?` |
| `c4` Fernanda Lopes | `Pode sim, Fernanda! A chave Pix é o CNPJ 12.345.678/0001-90. Assim que enviar o comprovante eu confirmo seu pedido.` |
| `c6` Beatriz Sousa | `Oi, Beatriz! Que bom que gostou. Quer que eu te envie o cardápio completo com os preços?` |

Não existe resposta para `c5` e `c7` (ambas `mode:'humano'`). As respostas são fixas por id de conversa: **não** dependem do tom, da base de respostas (kb), das instruções, do horário ("Quando responder") nem das regras de passagem. Não há detecção de "Passar para você quando" nas conversas (só na caixa "Testar o agente", ver 04-drawers.md). Não há notificação ao usuário no protótipo.

Efeitos colaterais após ligar a IA: conversas respondidas ficam com `mode:'ia'` e exibem selo sparkle na lista e pílula `Luna (IA) respondendo`; o filtro `Com IA` passa a listá-las.

## 5. Comportamento com a IA desligada vs ligada (resumo)

| Elemento | `iaOn=false` | `iaOn=true` |
|---|---|---|
| Selo sparkle no avatar | nunca | se `mode==='ia'` |
| Pílula de modo | `Você está atendendo` / `Aguardando resposta` / `Conversa aberta` (c3 com `mode:'ia'` cai em `Aguardando resposta` por ter `unread:1`) | `{nome} (IA) respondendo` se `mode==='ia'` |
| Botão Assumir | oculto | se `mode==='ia'` |
| Botão Devolver | oculto | se `mode==='humano'` |
| Placeholder do campo | `Digite uma mensagem` | `Escreva para assumir a conversa` se `mode==='ia'` |
| Abrir conversa zera não lidas | sim | não |
| Enviar muda modo para `'humano'` | não | sim |
| Chip na barra superior | não | `{nome} ativa` |
