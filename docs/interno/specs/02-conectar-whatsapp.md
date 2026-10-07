# 02 - Tela "Conectar WhatsApp" (`view='whatsapp'` e `connected=false`)

Fonte: HTML linhas 157-336 e lógica (`conectar`, `ofContinuar`, `ofLerQr`, `ofConcluir`, `trocarTipo`, `buildQr`). Tema CLARO (dentro de `<main>`).

Estado relevante: `provider` (`null | 'oficial' | 'rapida'`), `ofStep` (`'numero' | 'qr' | 'hist'`), `ofNumero` (padrão `'+55 11 98765-4321'`), `ofHist` (padrão `true`), `qrState` (`'aguardando' | 'conectando'`), `connected`.

Seleção de tela:
- `showChooser = view==='whatsapp' && !connected && !provider`
- `showOficial = view==='whatsapp' && !connected && provider==='oficial'`
- `showQrRapida = view==='whatsapp' && !connected && provider==='rapida'`
- Existe também `showQr` calculado mas não usado no markup.

Container comum das três telas (cada uma é um `<div>` filho direto de `main`):
```
flex:1; overflow-y:auto; display:grid; place-items:center; padding:32px;
background:radial-gradient(900px 480px at 30% 0%, var(--color-accent-900), transparent 70%), var(--color-bg)
```
Não há barra superior de 56px nesta tela (a barra "WhatsApp" só existe nas conversas).

---

## A. Escolha do tipo (`provider = null`)

Coluna central: `width:min(860px, 100%); display:flex; flex-direction:column; gap:22px; animation:zfIn .35s ease`.

Cabeçalho:
- Kicker `Primeiro passo` (`font:500 10.5px/1 var(--font-heading); letter-spacing:.16em; text-transform:uppercase; color:var(--color-accent-300)`).
- Título `Conecte seu WhatsApp` (`font:500 30px/1.15 var(--font-heading); letter-spacing:-.02em; margin-top:12px`).
- Parágrafo (`color:var(--color-neutral-400); margin-top:10px; max-width:56ch; text-wrap:pretty; line-height:1.5`):
  > Escolha como conectar. Nos dois casos você lê um QR code com o celular e continua usando o WhatsApp normalmente.

Cartões: container `display:flex; flex-wrap:wrap; gap:16px`. Cada cartão é um `<button class="card">`:
```
flex:1 1 320px; min-width:0; padding:22px; display:flex; flex-direction:column; gap:14px; text-align:left; cursor:pointer;
color:var(--color-text); border:1px solid {border}; background:{bg}; transition:border-color .2s, box-shadow .2s
hover: border-color:var(--color-accent-500); box-shadow:0 10px 30px rgba(29,33,23,.08)
```
- Oficial: `border: var(--color-accent-600)` (`#b3ca52`), `bg: color-mix(in srgb, var(--color-accent) 7%, var(--color-surface))` (levemente verde).
- Rápida: `border: var(--color-divider)`, `bg: var(--color-surface)`.
- Linha de cabeçalho do cartão: ícone 44×44 `border-radius:12px; background:var(--color-accent-900); border:1px solid var(--color-accent-700)` com `<i class="ph {icon}">` 21px `var(--color-accent-300)`; título `font:500 15.5px/1.25 var(--font-heading)`; subtítulo `font-size:12px; color:var(--color-neutral-500); margin-top:3px`; tag à direita `class="tag {tagClass}" style="font-size:10.5px; white-space:nowrap"`.
- Lista de vantagens: `display:flex; flex-direction:column; gap:8px`; cada item `display:flex; gap:8px; font-size:12.5px; line-height:1.4; color:var(--color-neutral-300)` com ícone 14px (`flex:0 0 auto; margin-top:1px`).
- CTA no rodapé do cartão: `display:flex; align-items:center; gap:6px; margin-top:auto; padding-top:4px; font:500 13px/1 var(--font-heading); color:var(--color-accent-300)` + ícone `ph ph-arrow-right` 13px.
- Clique: `provider = id`, `ofStep='numero'`, `qrState='aguardando'`.

**Cartão 1 - Oficial** (primeiro):
- Ícone `ph-seal-check`; título `WhatsApp Business oficial`; subtítulo `Pela plataforma da Meta`; tag `Recomendado` (`tag-accent`); CTA `Conectar oficial`.
- Itens:
  1. `ph-check` (cor `var(--color-accent-300)`): `Aprovado pela Meta, sem risco de bloqueio por uso de API`
  2. `ph-check`: `Disparos com modelos aprovados e mais estabilidade`
  3. `ph-check`: `Continua usando o app WhatsApp Business no celular`
  4. `ph-info` (cor `var(--color-neutral-500)`): `1.000 respostas grátis por mês, depois cobradas pela Meta`

**Cartão 2 - Conexão rápida**:
- Ícone `ph-qr-code`; título `Conexão rápida por QR`; subtítulo `Pelo WhatsApp Web`; tag `Não oficial` (`tag-neutral`); CTA `Conectar por QR`.
- Itens:
  1. `ph-check` (`accent-300`): `Pronto em 1 minuto, funciona com WhatsApp comum ou Business`
  2. `ph-check`: `Sem custo por mensagem`
  3. `ph-warning` (cor literal `#b0872f`): `Não aprovado pela Meta: disparos em massa podem bloquear o número`

Rodapé da tela: `font-size:11.5px; color:var(--color-neutral-500)`:
> Você pode trocar o tipo de conexão depois, em Configurações.

(Em Configurações do protótipo só existe o botão "Desconectar" do WhatsApp; ao desconectar `provider` volta a `null` e a escolha reaparece. Não há outro controle "trocar tipo" lá.)

---

## B. Fluxo oficial (`provider = 'oficial'`)

Cartão único: `class="card elev-md"`, `width:min(880px, 100%); padding:32px 36px; display:flex; flex-direction:column; gap:26px; animation:zfIn .35s ease; position:relative`.

### Cabeçalho do cartão (comum aos 3 passos)
Linha `display:flex; align-items:center; gap:14px; flex-wrap:wrap`:
- Link `← Trocar tipo de conexão` (botão sem estilo: `background:none; border:none; padding:0; color:var(--color-neutral-500); font-size:12px; display:flex; align-items:center; gap:5px`, ícone `ph ph-arrow-left`). Texto: `Trocar tipo de conexão`. Clique `trocarTipo`: `provider=null, ofStep='numero', qrState='aguardando'`. **Não cancela timers pendentes** (ver "Pontos de atenção").
- Espaçador `flex:1`.
- Indicador de 3 passos: `display:flex; align-items:center; gap:6px`. Cada passo: círculo 22×22 (`border-radius:999px; font:500 11px/1 var(--font-heading); border:1px solid {border}; background:{bg}; color:{color}`), rótulo `font-size:11.5px; white-space:nowrap; color:{labelColor}`, e traço entre passos `width:18px; height:1px; background:var(--color-divider)` (não após o último).
  - Rótulos: `Número`, `QR no app`, `Conversas`.
  - Concluído (índice < passo atual): número vira `✓`, `border accent-500`, `bg accent-500`, `color #f6f7ef`, `labelColor neutral-500`.
  - Atual: `border accent-500`, `bg accent-900`, `color accent-200`, `labelColor var(--color-text)`.
  - Futuro: `border divider`, `bg transparent`, `color neutral-500`, `labelColor neutral-500`.

### Passo 1 - `ofStep='numero'`
Layout: `display:flex; flex-wrap:wrap; gap:36px; align-items:flex-start`. Duas colunas: esquerda `flex:1 1 320px; min-width:0`; direita `flex:0 1 300px; min-width:260px`.

Coluna esquerda:
- Linha de kicker `display:flex; align-items:center; gap:8px`: `WhatsApp Business` (kicker accent-300 10.5px caixa alta .16em) + tag `Oficial` (`tag tag-accent`, 10px).
- Título `Qual número você usa no WhatsApp Business?` (`font:500 26px/1.15 var(--font-heading); letter-spacing:-.02em; margin-top:12px`).
- Parágrafo (`color:var(--color-neutral-400); margin-top:10px; max-width:46ch`): `Vamos ligar esse número à plataforma oficial da Meta. Ele continua funcionando no seu celular.`
- Campo: `<div class="field" style="margin-top:22px; max-width:340px">`, label `Número do WhatsApp Business`, `<input class="input" placeholder="+55 11 90000-0000">` com valor `ofNumero` (padrão `+55 11 98765-4321`). `onChange` grava o texto bruto em `ofNumero`.
- Botão: `class="btn btn-primary" style="margin-top:16px"` com ícone `ph ph-meta-logo` e texto `Continuar com a Meta`.
  - Validação (`ofContinuar`): `ofNumero.replace(/\D/g,'').length < 10` -> toast `Número incompleto` / `Digite o número com DDD` (ícone `ph-warning`) e fica no passo. (Mínimo 10 dígitos; só conta dígitos, nada mais é validado.)
  - Válido: `ofStep='qr'` e toast `Mensagem enviada` / `Abra o WhatsApp Business no celular` (ícone `ph-device-mobile`).

Coluna direita (caixa "Antes de começar"): `display:flex; flex-direction:column; gap:12px; padding:18px; border-radius:var(--radius-lg); background:var(--color-bg); border:1px solid var(--color-divider)`.
- Título `Antes de começar` (`font:500 13px/1.2 var(--font-heading)`).
- 3 itens (`display:flex; gap:9px; font-size:12px; line-height:1.45; color:var(--color-neutral-400)`, ícone 14px `var(--color-accent-300)`):
  1. `ph-device-mobile`: `O número precisa estar no app WhatsApp Business, versão atualizada.`
  2. `ph-meta-logo`: `Você vai entrar com sua conta do Facebook ou Meta Business.`
  3. `ph-users-three`: `Grupos continuam só no celular. Conversas individuais aparecem aqui.`

### Passo 2 - `ofStep='qr'`
Layout: `display:flex; flex-wrap:wrap; gap:40px; align-items:center`. Esquerda `flex:1 1 320px`; direita `flex:0 0 280px; display:flex; flex-direction:column; gap:12px`.

Esquerda:
- Título `Escaneie com o WhatsApp Business` (26px).
- Parágrafo: `Enviamos uma mensagem para {ofNumero}.` (usa o texto digitado).
- 3 instruções numeradas (`display:flex; flex-direction:column; gap:14px; margin-top:22px`). Cada uma: círculo 26×26 (`border:1px solid var(--color-accent-700); background:var(--color-accent-900); color:var(--color-accent-200); font:500 12px/1 var(--font-heading)`) + texto `font-size:13px; line-height:1.45; padding-top:3px`:
  1. `Abra a mensagem da Meta no WhatsApp Business e toque em Conectar à plataforma.`
  2. `Toque em Escanear QR code.`
  3. `Aponte a câmera para o código ao lado.`

Direita:
- Caixa do QR: `position:relative; width:280px; height:280px; padding:18px; border:1px solid var(--color-divider); border-radius:var(--radius-lg); background:var(--color-surface)`.
- Grade do QR: `display:grid; grid-template-columns:repeat(25, 1fr); width:100%; height:100%; opacity:{qrOpacity}; transition:opacity .3s` (opacidade `1`, ou `0.25` quando `qrState==='conectando'`). Cada célula `<div style="background:{bg}; border-radius:1px">`.
- Logo central: `position:absolute; left:50%; top:50%; width:44px; height:44px; margin:-22px 0 0 -22px; border-radius:10px; background:var(--color-surface); border:1px solid var(--color-divider); display:grid; place-items:center` com `ph-fill ph-leaf` 20px `var(--color-accent-400)`.
- Overlay quando `conectando`: `position:absolute; inset:0; border-radius:var(--radius-lg); background:color-mix(in srgb, var(--color-surface) 82%, transparent); display:flex; flex-direction:column; align-items:center; justify-content:center; gap:12px; animation:zfFade .2s ease`, com spinner 30×30 e texto `Confirmando com a Meta…` (`font:500 13px/1 var(--font-heading)`).
- Abaixo do QR: ponto 7×7 `var(--color-accent-400)` com `zfPulse 1.8s infinite` + texto fixo `O código expira em 2 minutos` (`font-size:12px; color:var(--color-neutral-400)`). Não há contagem regressiva nem renovação no protótipo.
- Botão `class="btn btn-secondary btn-block"` com ícone `ph ph-device-mobile-camera`: `Simular leitura do QR`. Clique `ofLerQr`: se `qrState==='conectando'` ignora; senão `qrState='conectando'` e, após **1500 ms**, `qrState='aguardando'` e `ofStep='hist'`.

### Passo 3 - `ofStep='hist'`
Layout igual ao passo 1 (`gap:36px`, duas colunas).

Esquerda:
- Linha de verificação: `display:flex; align-items:center; gap:8px; font-size:12px; color:var(--color-accent-300)` com `ph-fill ph-check-circle` + `{ofNumero} verificado`.
- Título `Trazer suas conversas?` (26px).
- Parágrafo: `Podemos importar os contatos e as conversas individuais dos últimos 6 meses. Grupos não são importados.`
- Duas opções (radio custom) em coluna `gap:8px; margin-top:20px; max-width:420px`; cada uma `padding:12px 14px; border-radius:var(--radius-md); border:1px solid ...` com bolinha 16×16 (miolo 8×8), título `font:500 13px/1.25 var(--font-heading)` e descrição `font-size:11.5px; color:var(--color-neutral-500); margin-top:2px`:
  1. `Importar conversas e contatos` / `Últimos 6 meses de conversas individuais` (valor `ofHist=true`, **selecionada por padrão**)
  2. `Começar do zero` / `Só as novas conversas aparecem aqui` (valor `false`)
  Selecionada: `border accent-600`, `bg accent-900`, bolinha `accent-400`; não selecionada: `border divider`, `bg transparent`, bolinha `neutral-700` sem miolo.
- Botão `class="btn btn-primary" style="margin-top:18px"` ícone `ph ph-check`: `Concluir conexão`. Clique `ofConcluir`: `connected=true`, `ofStep='numero'`; toast `WhatsApp oficial conectado` / (`ofHist` ? `Importando conversas dos últimos 6 meses` : `{ofNumero}`) com ícone `ph-seal-check`. `provider` permanece `'oficial'`. `qrState` não é alterado aqui.

Direita (box âmbar): `flex:0 1 300px; min-width:260px; display:flex; flex-direction:column; gap:10px; padding:18px; border-radius:var(--radius-lg); border:1px solid #ecd9b3; background:#fbf5e8`.
- Título `display:flex; align-items:center; gap:7px; font:500 13px/1.2 var(--font-heading); color:#6b5427` com ícone `ph ph-credit-card`: `Cadastre um pagamento na Meta`.
- Texto `font-size:12px; line-height:1.5; color:#6b5427`: `Cada número tem 1.000 respostas grátis por mês. Sem forma de pagamento no Meta Business, as respostas param quando o limite acaba.`
- Link-botão `align-self:flex-start; background:none; border:none; padding:0; color:#6b5427; text-decoration:underline; font-size:12px`: `Abrir Meta Business`. Clique: toast `Meta Business` / `Abriria a página de pagamentos da Meta` (ícone `ph-credit-card`).

Efeito pós-conexão oficial: `connected=true` e `provider='oficial'` -> view passa a mostrar as conversas (se `view==='whatsapp'`); sidebar mostra `Oficial · {ofNumero}`; drawers usam variantes oficiais (modelos aprovados, aviso de follow-up, medidor Meta no plano, lembrete via modelo na agenda). O contador de respostas de atendimento (`svcUsed`, inicial 640) sobe +1 a cada mensagem enviada pelo usuário na conversa.

---

## C. Conexão rápida (`provider = 'rapida'`)

Cartão: `class="card elev-md"`, `width:min(880px, 100%); padding:36px; display:flex; flex-wrap:wrap; gap:40px; align-items:center; animation:zfIn .35s ease`.

Coluna esquerda (`flex:1 1 320px; min-width:0`):
- Link `← Trocar tipo de conexão` (mesmo estilo, `margin-bottom:16px`; mesmo `trocarTipo`).
- Linha: kicker `Conexão rápida` + tag `Não oficial` (`tag tag-neutral`, 10px).
- Título `Conecte seu WhatsApp` (`font:500 30px/1.15`, `margin-top:12px`).
- Parágrafo (`max-width:44ch`): `Escaneie o código com o celular. Suas conversas abrem aqui e você liga as automações pelo menu lateral.`
- 3 passos (`margin-top:26px`, mesmo estilo dos passos do QR oficial):
  1. `Abra o WhatsApp no celular que você usa para atender clientes.`
  2. `Vá em Configurações e toque em Dispositivos conectados.`
  3. `Toque em Conectar um dispositivo e aponte a câmera para o código ao lado.`
- Aviso âmbar: `display:flex; gap:10px; margin-top:24px; padding:12px 14px; border-radius:var(--radius-md); border:1px solid #ecd9b3; background:#fbf5e8; font-size:12px; line-height:1.45; color:#6b5427`, ícone `ph ph-warning` 15px, texto:
  > Essa conexão não é aprovada pela Meta. Envios em massa podem levar ao bloqueio do número. Para disparos frequentes, prefira a conexão oficial.

Coluna direita (`flex:0 0 280px; display:flex; flex-direction:column; gap:12px`): igual à do passo 2 oficial (QR 280×280, grade 25×25, logo central), com diferenças:
- Overlay de carregamento mostra `Conectando…` (em vez de `Confirmando com a Meta…`).
- Texto de status ao lado do ponto pulsante (`zfPulse 1.8s`): `Aguardando leitura do código` (normal) / `Lendo código, aguarde…` (`qrState==='conectando'`).
- Botão `btn btn-secondary btn-block` ícone `ph ph-device-mobile-camera`: `Simular leitura do QR`.

Transição (`conectar()`): se `qrState==='conectando'` ignora. Senão `qrState='conectando'`; após **1700 ms**: `connected=true`, `qrState='aguardando'`, `provider='rapida'` e toast `WhatsApp conectado` / `Doce Ateliê · +55 11 98765-4321` (ícone `ph-whatsapp-logo`). Sidebar: `Conexão rápida · +55 11 98765-4321`.

---

## D. Resumo das transições e tempos

| Evento | Estado antes -> depois | Delay |
|---|---|---|
| Clicar cartão | `provider: null -> 'oficial' / 'rapida'`; `ofStep='numero'`; `qrState='aguardando'` | imediato |
| Continuar com a Meta (válido) | `ofStep: 'numero' -> 'qr'` + toast | imediato |
| Simular leitura (oficial) | `qrState: 'aguardando' -> 'conectando'` -> (1500 ms) `'aguardando'` + `ofStep: 'qr' -> 'hist'` | 1500 ms |
| Concluir conexão (oficial) | `connected=true`, `ofStep='numero'` + toast | imediato |
| Simular leitura (rápida) | `qrState: 'aguardando' -> 'conectando'` -> (1700 ms) `connected=true`, `qrState='aguardando'`, `provider='rapida'` + toast | 1700 ms |
| Trocar tipo | `provider=null`, `ofStep='numero'`, `qrState='aguardando'` | imediato |
| Desconectar | `connected=false`, `provider=null`, `ofStep='numero'`, `iaOn=false`, `fuOn=false`, `drawer=null` | imediato |

Timers são registrados em `_timers` por `later()` e limpos só em `componentWillUnmount`.

## E. Como o QR falso é desenhado (`buildQr`)

- Matriz 25×25 (625 células, renderizadas em ordem de linha), `seed = 11`, gerador LCG: `seed = (seed*9301 + 49297) % 233280; return seed/233280` (determinístico: o desenho é sempre igual).
- Três "olhos" (finder patterns) 7×7 nos cantos superior-esquerdo `[0,0]`, superior-direito `[0, 18]` e inferior-esquerdo `[18, 0]`: célula ligada se está na borda do quadrado (linha/coluna 0 ou 6) ou no centro 3×3 (linhas e colunas 2 a 4); o resto do 7×7 fica desligado.
- Zona de silêncio: células com `(r<8 && c<8)`, `(r<8 && c>=17)`, `(r>=17 && c<8)` fora do 7×7 ficam desligadas.
- Quadrado central de linhas 10 a 14 e colunas 10 a 14 desligado (abriga o logo 44×44).
- Demais células: `rnd() > 0.5` -> ligada.
- Cor: ligada = `var(--color-text)` (`#1d2117` no tema claro); desligada = `transparent`. Cada célula `border-radius:1px`.
- O QR do protótipo não é escaneável (apenas ilustrativo). Em produção usar a imagem do provedor.
