// Troca a senha de UMA conta (por e-mail). Pensado para a conta de demonstração, mas serve para qualquer conta.
//
//   ROTATE_PASSWORD='<senha nova>' npx tsx scripts/rotate-demo-password.ts <email>
//
// - A senha nova vem SÓ da variável de ambiente ROTATE_PASSWORD (nunca de argumento de linha de comando, que aparece na
//   lista de processos e no histórico do shell) e nunca é impressa.
// - Mínimo de 12 caracteres.
// - Sobe a versão de sessão (derruba todas as sessões abertas da conta) e apaga links de redefinição pendentes.
// - Opera no banco apontado por DATABASE_URL: em produção, rode no servidor e SÓ com autorização do dono.
import bcrypt from 'bcryptjs'
import { loadEnvConfig } from '@next/env'

loadEnvConfig(process.cwd())

function maskEmail(email: string): string {
  const at = email.lastIndexOf('@')
  return at > 0 ? `${email.slice(0, 1)}***${email.slice(at)}` : '***'
}

async function main() {
  const email = (process.argv[2] ?? '').trim().toLowerCase()
  if (!email || process.argv.length > 3) {
    console.error("Uso: ROTATE_PASSWORD='<senha nova>' npx tsx scripts/rotate-demo-password.ts <email>")
    process.exit(2)
  }
  const password = process.env.ROTATE_PASSWORD
  if (!password) {
    console.error('Defina a senha nova na variável de ambiente ROTATE_PASSWORD (não é aceita como argumento).')
    process.exit(2)
  }
  if (password.length < 12 || password.length > 200) {
    console.error('A senha precisa ter entre 12 e 200 caracteres.')
    process.exit(2)
  }

  const { db } = await import('../src/lib/db')
  try {
    const user = await db.user.findUnique({ where: { email }, select: { id: true } })
    if (!user) {
      console.error('Conta não encontrada.')
      process.exit(1)
    }
    const passwordHash = await bcrypt.hash(password, 10)
    await db.$transaction([
      db.user.update({ where: { id: user.id }, data: { passwordHash, sessionVersion: { increment: 1 } } }),
      db.verificationToken.deleteMany({ where: { identifier: `pwreset:${email}` } }),
    ])
    console.log(`Senha da conta ${maskEmail(email)} trocada. Todas as sessões abertas dela foram encerradas.`)
  } finally {
    await db.$disconnect()
  }
}

main().catch((e) => {
  console.error('Falha ao trocar a senha:', e instanceof Error ? e.message : 'erro')
  process.exit(1)
})
