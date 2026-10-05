// Cabeçalhos de segurança do APP (valem também sem o Caddy, por exemplo em desenvolvimento).
//
// Divisão de responsabilidades (para não duplicar cabeçalhos):
//   - AQUI (app): X-Frame-Options, X-Content-Type-Options, Referrer-Policy, Permissions-Policy e uma CSP mínima
//     (frame-ancestors/base-uri/object-src) que não depende de nonce.
//   - NO CADDY (deploy/Caddyfile): HSTS e Cross-Origin-Opener-Policy (só fazem sentido com HTTPS na borda) e a remoção
//     do cabeçalho Server.
//
// PENDÊNCIA (de propósito): Content-Security-Policy COMPLETA (script-src/style-src/connect-src...). Exige estudo, porque o app
// usa estilos inline (style="" nos componentes e nos e-mails), scripts inline do Next e o SDK do Facebook (Embedded Signup).
// Quando for feita, comece em modo "Report-Only" e libere no mínimo:
//   script-src   'self' 'nonce-…' https://connect.facebook.net
//   style-src    'self' 'unsafe-inline' https://fonts.googleapis.com
//   font-src     'self' https://fonts.gstatic.com
//   img-src      'self' data: blob: https://*.googleusercontent.com https://*.fbcdn.net https://pps.whatsapp.net
//   connect-src  'self' wss://<domínio> https://graph.facebook.com https://www.facebook.com
//   frame-src    https://www.facebook.com https://web.facebook.com (popup/iframe do login da Meta)
// (a CSP com nonce depende do Next 15: ver o aviso GHSA-ffhc-5mcf-pf4q no relatório de segurança).
const securityHeaders = [
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(self), geolocation=(), payment=(), usb=()' },
  // Parte da CSP que não quebra nada: ninguém embute o app em iframe, <base> e <object> não são usados.
  // (form-action fica de fora: o login com Google é um redirecionamento de formulário para outro domínio.)
  { key: 'Content-Security-Policy', value: "frame-ancestors 'none'; base-uri 'self'; object-src 'none'" },
];

// Mitigações do Next 14.2.35 (a migração para o Next 15 é uma etapa à parte; ver docs/operacao/publicacao.md):
//  - Otimizador de imagens: o app só usa next/image com SVGs locais e `unoptimized` (components/brand/logo.tsx e
//    site/sections/impact.tsx). Nenhuma imagem remota passa por /_next/image. Fica DESLIGADO (images.unoptimized), sem
//    domínios remotos e sem AVIF (o RCE GHSA-2xp9-vwfh-vxw4 exige AVIF). O Caddy também devolve 404 em /_next/image.
//  - Server Actions (login, cadastro, convite, verificação): só aceitam a origem do próprio site e corpo pequeno.
const publicHost = (() => {
  try {
    return new URL(process.env.NEXT_PUBLIC_APP_URL ?? process.env.AUTH_URL ?? '').host;
  } catch {
    return '';
  }
})();

/** @type {import('next').NextConfig} */
const nextConfig = {
  poweredByHeader: false,
  images: {
    unoptimized: true,
    formats: ['image/webp'],
    remotePatterns: [],
    domains: [],
  },
  experimental: {
    serverActions: {
      // Mesma origem (Host == Origin) já é aceita; a lista vale para quem acessa por um proxy com outro host.
      allowedOrigins: publicHost ? [publicHost] : [],
      bodySizeLimit: '256kb',
    },
  },
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }];
  },
};

export default nextConfig;
