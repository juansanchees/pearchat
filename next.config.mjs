// Cabeçalhos de segurança em todas as rotas.
//
// PENDÊNCIA (de propósito): Content-Security-Policy. Uma CSP completa exige estudo, porque o app usa estilos inline
// (style="" nos componentes e nos e-mails), scripts inline do Next e o SDK do Facebook (Embedded Signup). Quando for
// feita, comece em modo "Report-Only" e libere no mínimo:
//   script-src   'self' 'nonce-…' https://connect.facebook.net
//   style-src    'self' 'unsafe-inline' https://fonts.googleapis.com
//   font-src     'self' https://fonts.gstatic.com
//   img-src      'self' data: blob: https://*.googleusercontent.com https://*.fbcdn.net https://pps.whatsapp.net
//   connect-src  'self' wss://<domínio> https://graph.facebook.com https://www.facebook.com
//   frame-src    https://www.facebook.com https://web.facebook.com (popup/iframe do login da Meta)
//   frame-ancestors 'none'   (já coberto hoje pelo X-Frame-Options)
const securityHeaders = [
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(self), geolocation=(), payment=(), usb=()' },
];

/** @type {import('next').NextConfig} */
const nextConfig = {
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }];
  },
};

export default nextConfig;
