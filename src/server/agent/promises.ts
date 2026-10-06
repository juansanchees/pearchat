// Rede de segurança da regra "só promete ação da equipe quem passa a conversa": a IA dizer que a equipe (ou ela mesma)
// vai enviar, analisar, estornar, encaminhar ou retornar algo, SEM o marcador de passagem, deixava o cliente esperando
// por algo que ninguém foi avisado para fazer. Quem chama (finish.ts) transforma isso em passagem para uma pessoa.
// Lista conservadora, em português, espanhol e inglês. Não contam: frases condicionais ("se preferir, a equipe confirma")
// e verbos de envio quando a própria frase já traz o link ("te envio o link: https://...").

type Pattern = { re: RegExp; /** Verbo de envio: não conta se a própria frase já traz o link. */ envio?: boolean }

const TEAM_PT = '(?:equipe|time|suporte|setor|financeiro|pessoal|alguem|uma pessoa|um atendente|um especialista|um consultor)'
const ACAO_PT =
  '(?:enviar|reenviar|mandar|analisar|verificar|revisar|resolver|estornar|liberar|retornar|responder|entrar em contato|chamar|ligar|confirmar|avisar|ajudar|falar|cuidar|atender|providenciar|corrigir|ver|checar|contatar|processar|devolver|reembolsar|encaminhar|abrir|tratar|te|lhe)'
const TEAM_ES = '(?:equipo|soporte|area|departamento|alguien|una persona|un agente|un asesor)'
const FUT_ES =
  '(?:enviara|enviaran|reenviara|reenviaran|revisara|revisaran|analizara|analizaran|contactara|contactaran|escribira|escribiran|respondera|responderan|confirmara|confirmaran|resolvera|resolveran|encargara|encargaran|pondra|pondran|comunicara|comunicaran|llamara|gestionara|gestionaran|procesara|procesaran|devolvera|reembolsara|verificara|verificaran|ayudara|atendera|mandara|mandaran)'
const TEAM_EN = '(?:team|support|staff|someone|somebody|an agent|a person)'
const ACAO_EN =
  '(?:send|resend|email|contact|reach|get back|review|look|check|process|refund|reply|respond|call|help|follow|handle|sort|confirm|investigate|fix|reset|grant|unlock|be in touch|be reaching|be contacting)'

const PATTERNS: Pattern[] = [
  // pt: "a equipe vai te enviar", "nossa equipe de suporte irá analisar", "alguém vai te chamar", "a equipe te retorna"
  { re: new RegExp(`\\b${TEAM_PT}\\b(?: [a-z]+){0,3} (?:ja )?(?:vai|vao|ira|irao|deve|devera) ${ACAO_PT}\\b`) },
  { re: new RegExp(`\\b${TEAM_PT}\\b(?: [a-z]+){0,2} (?:te|lhe) (?:envia|enviara|reenvia|responde|respondera|retorna|retornara|contata|chama|liga|avisa|confirma|manda)\\b`) },
  { re: new RegExp(`\\b${TEAM_PT}\\b(?: [a-z]+){0,2} (?:entra|entrara) em contato\\b|\\b${TEAM_PT}\\b(?: [a-z]+){0,2} (?:confirma|fala|conversa|resolve|ve) (?:isso )?com voce\\b`) },
  { re: /\bvou (?:te |lhe )?(?:encaminhar|repassar|reenviar|liberar|estornar|solicitar|registrar|abrir (?:um )?chamado|verificar com|confirmar com|checar com|ver com|acionar|passar (?:pra|para|seu|sua|isso|o seu|a sua))\b/ },
  { re: /\bvou (?:te |lhe )?(?:enviar|mandar)\b|\b(?:eu )?(?:te|lhe) (?:envio|mando)\b/, envio: true },
  { re: /\b(?:ja )?(?:encaminhei|repassei|solicitei|registrei|acionei|abri (?:um )?chamado|passei (?:pra|para|seu|sua|o seu|a sua))\b/ },
  { re: /\b(?:vamos|iremos) (?:te |lhe )?(?:enviar|mandar|reenviar|analisar|verificar|resolver|estornar|liberar|retornar|entrar em contato|providenciar|encaminhar)\b/, envio: true },
  { re: /\b(?:te |lhe )?(?:retorno|respondo|aviso) (?:em breve|assim que|ja ja|logo)\b|\bja te (?:retorno|respondo|aviso)\b/ },
  { re: /\bem breve (?:isso )?(?:te chega|chega|alguem|a equipe)\b/ },
  // es: "el equipo te enviará", "lo derivo", "te lo envío", "le enviaremos", "ya pasé tu caso", "en breve te llega"
  { re: new RegExp(`\\b${TEAM_ES}\\b(?: [a-z]+){0,3} (?:te |le |lo |la |se |les )?(?:(?:va|van) a [a-z]+(?:ar|er|ir)|${FUT_ES})\\b`) },
  { re: /\b(?:lo|la|los|las|te lo|te la|se lo|se la|le) (?:derivo|escalo|remito)\b|\bderiv(?:o|are|amos|aremos)\b|\bya (?:pase|derive|envie|solicite|registre|escale|reporte)\b/ },
  { re: /\b(?:lo|la|los|las|te lo|te la|se lo|se la|le) (?:paso|envio|mando|reenvio)\b/, envio: true },
  { re: /\bvoy a (?:derivar|pasar|reenviar|escalar|consultar|verificar con|confirmar con|solicitar|registrar|gestionar|tramitar)\b/ },
  { re: /\bvoy a (?:enviar|mandar)\b|\bvamos a (?:enviar|mandar|reenviar|revisar|analizar|resolver|gestionar|procesar|devolver|contactar)\b/, envio: true },
  { re: /\b(?:enviaremos|mandaremos|escribiremos|contactaremos|responderemos|confirmaremos|revisaremos|gestionaremos|procesaremos|devolveremos)\b/, envio: true },
  { re: /\b(?:te |le )(?:confirmo|aviso|respondo|escribo) (?:en breve|apenas|cuando|pronto)\b/ },
  { re: /\ben breve (?:te |le )?(?:llega|llegara|escribe|escribira|contacta|contactara|responde|respondera)\b/ },
  // en: "our team will look into it", "someone will contact you", "I'll forward", "we'll send", "I've escalated"
  { re: new RegExp(`\\b${TEAM_EN}\\b(?: [a-z]+){0,3} (?:will|is going to|are going to) (?:be )?${ACAO_EN}\\b|\\b${TEAM_EN}'ll (?:be )?${ACAO_EN}\\b`) },
  { re: /\b(?:i'll|i will|we'll|we will|i'm going to|we're going to|im going to) (?:forward|pass|escalate|check with|confirm with|look into|get back|reach out|refund|process|open a ticket|follow up|contact|resend|review|investigate)\b/ },
  { re: /\b(?:i'll|i will|we'll|we will) (?:send|email|text)\b/, envio: true },
  { re: /\b(?:i've|i have|we've|we have) (?:forwarded|passed|escalated|submitted|opened|reported|requested)\b/ },
  { re: /\byou(?:'ll| will) hear (?:back|from)\b/ },
  // "estou passando / te paso con / I'm passing": dizer que já está passando também exige a passagem de fato.
  { re: /\b(?:estou|to|tou|ja estou) (?:passando|encaminhando|transferindo|repassando)\b/ },
  { re: /\b(?:estoy|ya estoy) (?:pasando|derivando|transfiriendo|escalando)\b|\bte (?:paso|comunico|transfiero) con\b/ },
  { re: /\b(?:i'm|i am|we're|we are) (?:passing|handing|transferring|forwarding|escalating|connecting)\b/ },
]

// Pedido de um dado ao cliente (e-mail, número do pedido, nome...): enquanto a IA ainda pede, não é hora de passar.
const DATA_ITEM = '(?:e ?mail|correo|numero|nombre|nome|cpf|pedido|order|comprovante|comprobante|receipt|telefone|codigo)'
const DATA_REQUEST: RegExp[] = [
  new RegExp(`\\b(?:me )?(?:passa|passe|manda|mande|envia|envie|informa|informe|diz|diga|fala|confirma|confirme)\\b.{0,30}\\b${DATA_ITEM}\\b`),
  new RegExp(`\\bpreciso (?:do|da|de) (?:seu |sua )?${DATA_ITEM}\\b|\\bqual (?:e )?(?:o )?(?:seu |sua )?${DATA_ITEM}\\b`),
  new RegExp(`\\b(?:me )?(?:pasas|pasa|pasame|envias|enviame|indicas|indica|indicame|confirmas|confirma|confirmame|dices|dime|compartes|comparte|podrias|podria)\\b.{0,30}\\b${DATA_ITEM}\\b`),
  new RegExp(`\\bnecesito (?:tu|su|el) ${DATA_ITEM}\\b`),
  new RegExp(`\\b(?:send|give|share|tell|confirm)\\b.{0,20}\\b${DATA_ITEM}\\b|\\b(?:i'll |i will |i )?need (?:the|your) ${DATA_ITEM}\\b|\\bwhat(?:'s| is) (?:the|your) ${DATA_ITEM}\\b`),
]

/** A resposta pede um dado ao cliente? */
export function requestsData(text: string): boolean {
  const t = norm(text).replace(/-/g, ' ')
  return DATA_REQUEST.some((re) => re.test(t))
}

const COND = "(?:se (?:voce |vc )?(?:preferir|quiser)|caso (?:voce )?(?:prefira|queira)|si (?:tu |usted )?(?:prefieres|quieres|lo prefieres|prefiere|quiere|lo deseas|deseas)|if you(?:'d)? (?:prefer|like|want|would like))\\b"
const CONDITIONAL = new RegExp(`^${COND}`)
/** Oferta condicional em qualquer ponto da frase ("Sou o assistente virtual; se preferir, chamo alguém"). */
const CONDITIONAL_ANY = new RegExp(`\\b${COND}`)
const HAS_URL = /(?:https?:\/\/|www\.)\S+/i

function norm(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[’`´]/g, "'")
    .replace(/[^a-z0-9'\s.!?…:/]/g, ' ')
    .replace(/[ \t]+/g, ' ')
}

const sentencesOf = (text: string): string[] =>
  norm(text)
    .split(/(?<=[.!?…])\s+|\n+/)
    .map((s) => s.trim())
    .filter(Boolean)

/** Alguma frase é uma oferta condicional ("se preferir, chamo alguém da equipe")? */
export function hasConditionalOffer(text: string): boolean {
  return sentencesOf(text).some((s) => CONDITIONAL_ANY.test(s))
}

/** A resposta promete uma ação da equipe (ou da própria IA) que exigiria alguém ser avisado? */
export function promisesTeamAction(text: string): boolean {
  for (const s of sentencesOf(text)) {
    if (CONDITIONAL.test(s)) continue
    const url = HAS_URL.test(s)
    if (PATTERNS.some((p) => (!p.envio || !url) && p.re.test(s))) return true
  }
  return false
}
