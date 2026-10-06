# Repositório (GitHub): privado, protegido e vigiado

Hoje o repositório é **público**. Isso mostra a qualquer pessoa o código exato que roda no servidor, a estrutura de publicação e todo o histórico. Nesta etapa já foram tirados do código e da documentação: o endereço do servidor, o usuário e o caminho da chave SSH, as credenciais de contas de demonstração e o seu e-mail pessoal do Caddyfile. **Mas o histórico antigo do git ainda os contém**: trate-os como públicos para sempre. A varredura do histórico não achou nenhuma chave real (só exemplos e uma senha de conta de demonstração).

## 1. Tornar o repositório privado (a medida mais barata)

1. GitHub → o repositório → **Settings → General → Danger Zone → Change repository visibility → Make private**.
2. **Confira o que depende dele:** o deploy usa a pasta do seu computador (não depende do GitHub). Se você usa o GitHub Actions (CI), o plano gratuito de repositório privado tem minutos limitados por mês (suficiente para este projeto). O Dependabot continua funcionando.
3. Se alguma pessoa de confiança precisa acessar: **Settings → Collaborators**.

## 2. Ligar a vigilância de segredos

**Settings → Code security** (ou "Advanced Security"):

- **Secret scanning** e **Push protection**: ligam o aviso/bloqueio quando alguém tenta enviar uma chave no código.
- **Dependabot alerts** e **Dependabot security updates**: avisam de dependências com falha. (O arquivo `.github/dependabot.yml` já abre pedidos semanais de atualização.)

O repositório também roda o **gitleaks** em cada envio (`.github/workflows/ci.yml`).

## 3. Proteger a branch principal

**Settings → Branches → Add branch ruleset** (ou "Branch protection rule") para `main`:

- exigir **pull request** antes de juntar (mesmo trabalhando sozinho, é a rede de segurança);
- exigir que o job **`verificar`** do CI esteja verde;
- bloquear **force push** e a exclusão da branch.

## 4. Sua conta do GitHub

Ligue a **verificação em 2 etapas** em **Settings → Password and authentication**. Quem controla a sua conta controla o código que vai para produção.

## 5. O que NUNCA deve ir para o repositório

`.env`, `deploy/.env.production`, `deploy/.deploy.env`, `deploy/.validate.env`, `/root/.pearchat-backup-key`, qualquer chave ou token, endereço do servidor. Os quatro primeiros arquivos já estão no `.gitignore`. Se uma chave for enviada por engano: **troque a chave** (`chaves.md`) antes de apagar o commit; apagar o commit não adianta, o histórico já foi copiado.

## 6. Capturas de tela da documentação

A pasta `docs/screenshots` guarda capturas do app com dados de **demonstração** (a conta "Doce Ateliê" e contatos fictícios; uma captura de configuração de 2 etapas mostra o código de uma conta de teste, desativada). Antes de tornar o repositório público de novo, **revise** as capturas: nenhuma deve mostrar nome, telefone ou conversa de cliente real.
