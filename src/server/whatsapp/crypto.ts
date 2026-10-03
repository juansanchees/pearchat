import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'

// AES-256-GCM. Formato: "v1:" + base64(iv[12] | tag[16] | ciphertext).
const PREFIX = 'v1:'

function getKey(): Buffer {
  const raw = process.env.ENCRYPTION_KEY
  if (!raw) throw new Error('ENCRYPTION_KEY não configurada')
  const key = Buffer.from(raw, 'base64')
  if (key.length !== 32) throw new Error('ENCRYPTION_KEY deve ser base64 de 32 bytes')
  return key
}

export function encrypt(text: string): string {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', getKey(), iv)
  const enc = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return PREFIX + Buffer.concat([iv, tag, enc]).toString('base64')
}

export function decrypt(payload: string): string {
  if (!payload.startsWith(PREFIX)) throw new Error('Formato de dado criptografado inválido')
  const buf = Buffer.from(payload.slice(PREFIX.length), 'base64')
  if (buf.length < 29) throw new Error('Dado criptografado truncado')
  const iv = buf.subarray(0, 12)
  const tag = buf.subarray(12, 28)
  const data = buf.subarray(28)
  const decipher = createDecipheriv('aes-256-gcm', getKey(), iv)
  decipher.setAuthTag(tag)
  return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8')
}
