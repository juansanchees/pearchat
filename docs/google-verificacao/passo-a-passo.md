# Tirar a tela "O Google não verificou este app"

Você faz 6 passos, nesta ordem. O orquestrador acompanha e confere cada um.
Arquivos de apoio (mesma pasta): `textos-para-colar.md` (textos em inglês para colar) e `roteiro-do-video.md` (o que gravar).

Regras:
- Use sempre a MESMA conta Google que é dona do projeto no Google Cloud (a que criou o cliente OAuth do PearChat). Confira o e-mail no canto superior direito de cada site.
- Enquanto o Google analisa, não mude nome, logo, links, site nem permissões. Mudar trava a análise.
- Os nomes dos botões podem variar um pouco. Se não achar algo, tire um print e mande ao orquestrador.

Palavras: "escopo" = permissão que o app pede ao Google. O PearChat pede 2: ler/editar eventos e ler a lista de agendas.

---

## Passo 1. Provar que o domínio pearchat.online é seu (20 min + espera)

1. Abra https://search.google.com/search-console e entre com a conta dona do projeto.
2. No canto superior esquerdo, clique no nome da propriedade → "Adicionar propriedade".
3. Na caixa da esquerda ("Domínio"), digite `pearchat.online` (sem https:// e sem www). Clique em "Continuar".
4. Aparece um texto que começa com `google-site-verification=`. Clique em "Copiar". Deixe essa janela aberta.
5. Em outra aba, entre em godaddy.com → "Meus produtos" → ao lado de pearchat.online, clique em "DNS".
6. Clique em "Adicionar novo registro" e preencha:
   - Tipo: `TXT`
   - Nome: `@`
   - Valor: cole o texto copiado
   - TTL: deixe o padrão
   - Salvar.
7. Volte ao Search Console e clique em "Verificar". Se disser que não encontrou, espere 15 minutos e tente de novo (pode levar até 1 ou 2 dias).
8. Quando aparecer "Propriedade verificada", acabou. NUNCA apague esse registro TXT depois (apagar desfaz a verificação).

Pronto quando: "Propriedade verificada". Avise o orquestrador; ele confere no DNS público.

## Passo 2. Preencher e publicar a marca (20 min)

1. Abra https://console.cloud.google.com e escolha, no seletor de projeto (topo), o projeto do PearChat.
2. Menu (três riscos, canto superior esquerdo) → "Plataforma de autenticação do Google" (Google Auth Platform) → "Branding" (pode aparecer como "Marca").
3. Preencha com estes valores, exatamente:

| Campo | Valor |
|---|---|
| Nome do app (App name) | `PearChat` |
| E-mail de suporte do usuário (User support email) | `j.dslsanches@gmail.com` (escolha na lista) |
| Logotipo (App logo) | arquivo `C:\Users\jdsl\OneDrive\Documentos\Dashboard CRM Gamificado\pearchat\public\brand\pearchat-avatar-512.png` |
| Página inicial do app (Application home page) | `https://pearchat.online/` |
| Link da política de privacidade | `https://pearchat.online/privacidade` |
| Link dos termos de serviço | `https://pearchat.online/termos` |
| Domínios autorizados (Authorized domains) | `pearchat.online` |
| Contato do desenvolvedor (Developer contact) | `j.dslsanches@gmail.com` |

4. Salve (vira "rascunho"). Clique em "Verificar marca" (Verify Branding). A análise automática leva alguns minutos.
5. Quando o status for "Pronto para publicar" (Ready to publish), clique em "Publicar marca" (Publish branding). Faça isso em até 7 dias, senão precisa repetir.
6. Se aparecer "Precisa corrigir problemas" (Need to fix issues), clique em "Ver problemas", tire um print e mande ao orquestrador.
7. Menu → "Clientes" (Clients): anote quantos clientes OAuth existem. Se houver mais de um, avise o orquestrador (o vídeo precisa cobrir todos) e não apague nada sozinho.

Pronto quando: marca publicada. Só então o nome PearChat e o logo passam a aparecer na tela do Google.

## Passo 3. Declarar as permissões (10 min)

Antes, espere o orquestrador confirmar a lista final de escopos (ele pode trocar um por outro mais estreito antes de você gravar o vídeo).

1. Menu → "Acesso a dados" (Data Access) → "Adicionar ou remover escopos".
2. Em "Adicionar escopos manualmente" (Manually add scopes), cole, um por linha:
   ```
   https://www.googleapis.com/auth/calendar.events
   https://www.googleapis.com/auth/calendar.readonly
   ```
3. Clique em "Adicionar à tabela" → "Atualizar" → "Salvar".
4. Confira em qual seção cada um caiu (sensíveis ou não sensíveis) e mande um print ao orquestrador.

O texto de justificativa de cada escopo está pronto em `textos-para-colar.md`, seção 2. Você cola no passo 5.

## Passo 4. Gravar o vídeo e subir no YouTube (1 h)

1. Grave depois do passo 2 publicado, seguindo `roteiro-do-video.md` (2 a 3 minutos).
2. Abra https://studio.youtube.com → "Criar" → "Enviar vídeos" → escolha o arquivo.
3. Em "Visibilidade", marque "Não listado" (nunca "Particular"). Salve e copie o link.
4. Teste o link numa janela anônima: tem que abrir sem login.

## Passo 5. Enviar para o Google (20 min)

1. Menu → "Central de verificação" (Verification Center).
2. Confira que a marca aparece como publicada. Em "Acesso a dados", clique no botão de preparar/enviar para verificação.
3. Confira os dados mostrados e continue.
4. Justificativa: cole o texto de cada escopo (`textos-para-colar.md`, seção 2).
5. Links de documentação (até 3):
   - `https://pearchat.online/#funcionalidades`
   - `https://pearchat.online/privacidade#google`
6. Vídeo: cole o link do YouTube.
7. Clique em "Enviar para verificação" (Submit for verification) e tire um print da confirmação.

## Passo 6. Depois de enviar

- O Google responde por e-mail (confira também o spam), para `j.dslsanches@gmail.com`. Se pedir algo, responda no próprio e-mail e avise o orquestrador; há respostas prontas em `textos-para-colar.md`, seção 3.
- Prazo informado pelo Google: marca 2 a 3 dias úteis; permissões sensíveis cerca de 10 dias úteis (outra página do Google diz 3 a 5). Sem garantia, e depende de você responder rápido. Se houver idas e voltas, conte de 1 a 4 semanas (estimativa nossa, não do Google).
- Até aprovar, a tela de aviso continua. Cada cliente clica em "Avançado" → "Acessar pearchat.online (não seguro)" e segue.
- Limite de 100 novos usuários: vale enquanto não aprovar, não zera nunca e conta quem autoriza o Google Agenda. Veja o contador em "Público-alvo" (Audience). Perto de 80, avise o orquestrador.
- Pedidos comuns do Google: vídeo sem o ID do cliente na barra de endereço ou com a tela de permissão fora do inglês; justificativa vaga ou pedido para usar escopo mais estreito; domínio não verificado; link do vídeo "Particular".
- Quando aprovar: o aviso some em algumas horas. Teste conectando com a conta Gmail de outra pessoa.
