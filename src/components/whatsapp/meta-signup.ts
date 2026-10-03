// Embedded Signup da Meta (Coexistence): carrega o SDK JS do Facebook e abre o popup.

type FbLoginResponse = { authResponse?: { code?: string } | null; status?: string }
type FbSdk = {
  init(opts: { appId: string; autoLogAppEvents: boolean; xfbml: boolean; version: string }): void
  login(cb: (r: FbLoginResponse) => void, opts: Record<string, unknown>): void
}
type FbWindow = Window & { FB?: FbSdk; fbAsyncInit?: () => void }

const SDK_URL = 'https://connect.facebook.net/pt_BR/sdk.js'
const GRAPH_VERSION = 'v23.0'

let sdkPromise: Promise<FbSdk> | null = null

export function loadFacebookSdk(appId: string): Promise<FbSdk> {
  const w = window as FbWindow
  if (w.FB) return Promise.resolve(w.FB)
  if (sdkPromise) return sdkPromise
  sdkPromise = new Promise<FbSdk>((resolve, reject) => {
    w.fbAsyncInit = () => {
      if (!w.FB) return reject(new Error('SDK da Meta indisponível'))
      w.FB.init({ appId, autoLogAppEvents: true, xfbml: false, version: GRAPH_VERSION })
      resolve(w.FB)
    }
    const script = document.createElement('script')
    script.src = SDK_URL
    script.async = true
    script.defer = true
    script.crossOrigin = 'anonymous'
    script.onerror = () => {
      sdkPromise = null
      reject(new Error('Não foi possível carregar o SDK da Meta'))
    }
    document.body.appendChild(script)
  })
  return sdkPromise
}

export type EmbeddedSignupResult = { code: string; phoneNumberId: string; wabaId: string }
export type EmbeddedSignupHandle = { promise: Promise<EmbeddedSignupResult>; cancel: () => void }

function parseMessage(data: unknown): { event: string; phoneNumberId?: string; wabaId?: string } | null {
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
  const d = (o.data && typeof o.data === 'object' ? o.data : {}) as { phone_number_id?: unknown; waba_id?: unknown }
  return {
    event: o.event,
    phoneNumberId: typeof d.phone_number_id === 'string' ? d.phone_number_id : undefined,
    wabaId: typeof d.waba_id === 'string' ? d.waba_id : undefined,
  }
}

/**
 * Abre o Embedded Signup e resolve quando chegam, os dois: o `code` do FB.login e o evento
 * WA_EMBEDDED_SIGNUP (phone_number_id + waba_id). Rejeita se o usuário cancelar.
 */
export function startEmbeddedSignup(appId: string, configId: string): EmbeddedSignupHandle {
  let cleanup = () => {}
  const promise = new Promise<EmbeddedSignupResult>((resolve, reject) => {
    let code: string | undefined
    let ids: { phoneNumberId: string; wabaId: string } | undefined
    let done = false

    const finishIfReady = () => {
      if (done || !code || !ids) return
      done = true
      cleanup()
      resolve({ code, ...ids })
    }
    const fail = (msg: string) => {
      if (done) return
      done = true
      cleanup()
      reject(new Error(msg))
    }

    const onMessage = (ev: MessageEvent) => {
      if (!/^https:\/\/([a-z0-9-]+\.)?facebook\.com$/.test(ev.origin)) return
      const msg = parseMessage(ev.data)
      if (!msg) return
      if (msg.event.startsWith('FINISH') && msg.phoneNumberId && msg.wabaId) {
        ids = { phoneNumberId: msg.phoneNumberId, wabaId: msg.wabaId }
        finishIfReady()
      } else if (msg.event === 'CANCEL' || msg.event === 'ERROR') {
        fail('Conexão cancelada na janela da Meta')
      }
    }
    window.addEventListener('message', onMessage)
    const timer = window.setTimeout(() => fail('Tempo esgotado esperando a Meta'), 10 * 60 * 1000)
    cleanup = () => {
      window.removeEventListener('message', onMessage)
      window.clearTimeout(timer)
    }

    loadFacebookSdk(appId)
      .then((fb) => {
        if (done) return
        fb.login(
          (r) => {
            if (r.authResponse?.code) {
              code = r.authResponse.code
              finishIfReady()
            } else {
              fail('Conexão cancelada na janela da Meta')
            }
          },
          {
            config_id: configId,
            response_type: 'code',
            override_default_response_type: true,
            extras: { setup: {}, featureType: 'whatsapp_business_app_onboarding', sessionInfoVersion: '3' },
          },
        )
      })
      .catch((e: unknown) => fail(e instanceof Error ? e.message : 'Falha ao abrir a Meta'))
  })
  return {
    promise,
    cancel: () => {
      cleanup()
    },
  }
}
