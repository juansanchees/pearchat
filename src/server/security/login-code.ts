// Código de 6 dígitos por e-mail ao entrar de um dispositivo não reconhecido. Mesmo mecanismo da verificação de e-mail
// do cadastro (src/server/mail/email-verification.ts), com outro prefixo em VerificationToken:
//  - `logincode:<userId>`       o código (hash com pepper), 10 min, uso único
//  - `logincode-sent:<userId>`  um registro por envio: reenvio só depois de 60 s e no máximo 5 por hora
//  - `logincode-try:<userId>`   um registro por tentativa: no 5º erro o código trava (precisa de "Reenviar código")
import { emailCodeFlow } from '@/server/mail/email-verification'
import { loginCodeEmail } from '@/server/mail/templates'

const flow = emailCodeFlow('logincode', loginCodeEmail)

export const issueLoginCode = flow.issue
export const verifyLoginCode = flow.verify
export const loginCodeSendState = flow.sendState
