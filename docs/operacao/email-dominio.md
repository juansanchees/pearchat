# E-mail e domínio: SPF, DKIM, DMARC e CAA

Para quando você ligar o **Resend** (o serviço que envia o código de verificação e o link de "esqueci minha senha"). Sem esses registros no DNS, os e-mails do PearChat caem no spam ou nem são enviados.

Quem faz: **você**, no painel onde está o DNS do domínio (hoje, o GoDaddy). Nada disso mexe no servidor. Risco baixo: um erro afeta só o e-mail.

## Como está hoje (conferido por consulta pública de DNS)

O domínio **não tem SPF, nem DKIM, nem MX**. Só existe um DMARC padrão do GoDaddy com política `quarantine`. Na prática: e-mails enviados em nome do domínio **não passam** na verificação e vão para o spam.

## Passo a passo

### 1. Verificar o domínio no Resend

1. Em **resend.com/domains**, adicione o domínio. **Melhor usar um subdomínio** só para envio (ex.: `mail.seu-dominio`): se algo der errado, o domínio principal não sofre.
2. O Resend mostra uma lista de registros (um **TXT de DKIM**, e um **SPF** e um **MX** no subdomínio `send`). Crie **exatamente** esses registros no DNS (GoDaddy → Domínios → DNS → Adicionar). Não digite de cabeça: copie do painel do Resend.
3. Volte ao Resend e clique em **Verify**. Pode levar de minutos a horas.

### 2. Configurar o remetente no servidor

No `/opt/pearchat/deploy/.env.production` **do servidor**: `RESEND_API_KEY` (a chave do Resend) e `MAIL_FROM="PearChat <nao-responda@o-dominio-verificado>"`. Recrie o app (`chaves.md`). Teste: crie uma conta com um e-mail seu e use "Esqueci minha senha". No e-mail recebido, abra "Mostrar original" e procure `spf=pass dkim=pass dmarc=pass`.

### 3. DMARC (proteção contra falsificação do seu domínio)

Edite o registro TXT `_dmarc` para: `v=DMARC1; p=quarantine; rua=mailto:SEU-EMAIL; adkim=r; aspf=r` (troque `SEU-EMAIL` por um e-mail seu: é para onde chegam os relatórios). Depois de **2 semanas** sem relatórios de falha legítima, mude `p=quarantine` para `p=reject`.

### 4. Domínio principal que não envia e-mail

Se só o subdomínio envia: SPF do domínio principal `v=spf1 -all` (ninguém pode enviar por ele) e um **MX nulo** (`0 .`). Isso impede que golpistas usem o seu domínio.

### 5. CAA (quem pode emitir certificado para o seu domínio)

Crie no DNS (tipo **CAA**):

- `0 issue "letsencrypt.org"`
- `0 issuewild ";"`
- `0 iodef "mailto:SEU-EMAIL"`

**Risco:** um CAA errado **bloqueia a renovação do certificado** do site (hoje válido até o início de 2027; renova sozinho ~30 dias antes). Se o log do Caddy (`docker logs pearchat-caddy-1`) mostrar emissão pela ZeroSSL, acrescente também `0 issue "zerossl.com"`. Em caso de dúvida, **não crie o CAA**: o ganho é pequeno e o risco é de ficar sem certificado.

### 6. A conta do domínio

No GoDaddy (ou onde o domínio estiver): ligue a **verificação em 2 etapas**, a **trava de transferência** e a **renovação automática**. Ligue o **DNSSEC** se o painel oferecer para o seu domínio.

## Depois de tudo

Quando o Resend estiver funcionando, o monitor interno também passa a avisar por e-mail: veja a seção final de `monitoramento.md`.
