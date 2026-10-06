// Valida o ambiente de produção SEM subir o servidor: usa as mesmas regras do guarda de inicialização.
// Uso (o deploy roda isto na imagem nova, com o .env.production do servidor, antes de trocar o app):
//   docker compose ... run --rm --no-deps -T app node_modules/.bin/tsx scripts/check-env.ts
// Saída: lista de erros/avisos (sem valores de segredos). Código 0 = pode subir; 78 = recusaria subir.
import { assertProductionEnv, checkProductionEnv } from '../src/server/boot/guard'

const issues = checkProductionEnv(process.env)
if (issues.length === 0) console.log('CHECK_ENV_OK (nenhum erro nem aviso)')
else assertProductionEnv(process.env, { sink: { error: (m) => console.log(m), warn: (m) => console.log(m) } })
if (!issues.some((i) => i.level === 'erro')) console.log('CHECK_ENV_OK')
