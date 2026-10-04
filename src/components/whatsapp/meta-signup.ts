// Cadastro incorporado (Embedded Signup v4) da Meta: carrega o SDK JS do Facebook e abre o popup (FB.login).
// O listener do `postMessage` (evento WA_EMBEDDED_SIGNUP) devolve waba_id / phone_number_id / business_id.

type FbLoginResponse = { authResponse?: { code?: string } | null; status?: string }
export type FbSdk = {
  init(opts: { appId: string; autoLogAppEvents: boolean; xfbml: boolean; version: string }): void
  login(cb: (r: FbLoginResponse) => void, opts: Record<string, unknown>): void
}
type FbWindow = Window & { FB?: FbSdk; fbAsyncInit?: () => void }

const SDK_URL = 'https://connect.facebook.net/pt_BR/sdk.js'
const SDK_TIMEOUT_MS = 12_000

export type SignupOptions = {
  appId: string
  configId: string
  /** Versão da Graph API do SDK (ex.: v25.0). */
  graphVersion: string
  /** Informações de sessão (padrão 3). */
  sessionInfoVersion: string
  /** Opcional: força o fluxo (ex.: whatsapp_business_app_onboarding). Vazio = o popup da Meta decide. */
  featureType?: string
}

let sdkPromise: Promise<FbSdk> | null = null

/** Carrega o SDK. Rejeita em até 12 s (bloqueador de anúncios, rede): a tela então cai para o link hospedado pela Meta. */
export function loadFacebookSdk(appId: string, graphVersion: string): Promise<FbSdk> {
  const w = window as FbWindow
  if (w.FB) return Promise.resolve(w.FB)
  if (sdkPromise) return sdkPromise
  sdkPromise = new Promise<FbSdk>((resolve, reject) => {
    const timer = window.setTimeout(() => {
      sdkPromise = null
      reject(new Error('O SDK da Meta demorou demais para carregar'))
    }, SDK_TIMEOUT_MS)
    w.fbAsyncInit = () => {
      window.clearTimeout(timer)
      if (!w.FB) {
        sdkPromise = null
        return reject(new Error('SDK da Meta indisponível'))
      }
      w.FB.init({ appId, autoLogAppEvents: true, xfbml: false, version: graphVersion })
      resolve(w.FB)
    }
    const script = document.createElement('script')
    script.src = SDK_URL
    script.async = true
    script.defer = true
    script.crossOrigin = 'anonymous'
    script.onerror = () => {
      window.clearTimeout(timer)
      sdkPromise = null
      reject(new Error('Não foi possível carregar o SDK da Meta'))
    }
    document.body.appendChild(script)
  })
  return sdkPromise
}

export type EmbeddedSignupResult = {
  code: string
  wabaId?: string
  phoneNumberId?: string
  businessId?: string
  /** FINISH, FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING (Coexistence)... */
  event: string
}
export type EmbeddedSignupHandle = { promise: Promise<EmbeddedSignupResult>; cancel: () => void }

type Parsed = { event: string; data: Record<string, unknown> }

function parseMessage(data: unknown): Parsed | null {
  let obj: unknown = data
  if (typeof data === 'string') {
    try {
      obj = JSON.parse(data)
    } catch {
      return null
    }
  }
  if (!obj || typeof obj !== 'object') return null
  const o = obj as { type?: unknown; event?: unknown; data?: unknown }
  if (o.type !== 'WA_EMBEDDED_SIGNUP' || typeof o.event !== 'string') return null
  return { event: o.event, data: (o.data && typeof o.data === 'object' ? o.data : {}) as Record<string, unknown> }
}

const s = (v: unknown): string | undefined => (typeof v === 'string' && v ? v : typeof v === 'number' ? String(v) : undefined)

/** Aceita só mensagens vindas de facebook.com (a Meta usa www., business. e web.). */
const FB_ORIGIN = /^https:\/\/([a-z0-9-]+\.)*facebook\.com$/

/**
 * Abre o Cadastro incorporado e resolve quando chegam, os dois: o `code` do FB.login e o evento WA_EMBEDDED_SIGNUP
 * FINISH* (waba_id; phone_number_id fora da Coexistence). Rejeita se o usuário cancelar ou se a Meta reportar erro.
 *
 * IMPORTANTE: chame direto do clique do usuário (síncrono) com o SDK já carregado, senão o navegador bloqueia o popup.
 */
export function startEmbeddedSignup(fb: FbSdk, opts: SignupOptions): EmbeddedSignupHandle {
  let cleanup = () => {}
  const promise = new Promise<EmbeddedSignupResult>((resolve, reject) => {
    let code: string | undefined
    let finish: Parsed | undefined
    let done = false
    let graceTimer: number | undefined

    const settle = () => {
      if (done || !code || !finish) return
      done = true
      cleanup()
      resolve({
        code,
        event: finish.event,
        wabaId: s(finish.data.waba_id),
        phoneNumberId: s(finish.data.phone_number_id),
        businessId: s(finish.data.business_id),
      })
    }
    const fail = (msg: string) => {
      if (done) return
      done = true
      cleanup()
      reject(new Error(msg))
    }

    const onMessage = (ev: MessageEvent) => {
      if (!FB_ORIGIN.test(ev.origin)) return
      const msg = parseMessage(ev.data)
      if (!msg) return
      if (msg.event.startsWith('FINISH')) {
        finish = msg
        settle()
      } else if (msg.event === 'CANCEL') {
        fail('Conexão cancelada na janela da Meta')
      } else if (msg.event === 'ERROR') {
        fail(s(msg.data.error_message) ?? 'A Meta informou um erro durante o cadastro')
      }
    }
    window.addEventListener('message', onMessage)
    const timer = window.setTimeout(() => fail('Tempo esgotado esperando a Meta'), 10 * 60 * 1000)
    cleanup = () => {
      window.removeEventListener('message', onMessage)
      window.clearTimeout(timer)
      if (graceTimer) window.clearTimeout(graceTimer)
    }

    fb.login(
      (r) => {
        if (r.authResponse?.code) {
          code = r.authResponse.code
          settle()
          // O evento FINISH normalmente chega junto; se não vier em 15 s, desiste com uma mensagem clara.
          if (!done) graceTimer = window.setTimeout(() => fail('A Meta não informou a conta do WhatsApp. Tente de novo.'), 15_000)
        } else {
          fail('Conexão cancelada na janela da Meta')
        }
      },
      {
        config_id: opts.configId,
        response_type: 'code',
        override_default_response_type: true,
        extras: {
          setup: {},
          sessionInfoVersion: opts.sessionInfoVersion,
          ...(opts.featureType ? { featureType: opts.featureType } : {}),
        },
      },
    )
  })
  return {
    promise,
    cancel: () => {
      cleanup()
    },
  }
}
