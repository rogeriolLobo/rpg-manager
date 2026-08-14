const CSP = [
  "default-src 'self'",
  "script-src 'self' https://challenges.cloudflare.com",
  "style-src 'self' 'unsafe-inline'",
  // Capas de RPG podem vir de qualquer host HTTPS (ver shared/security/cover-url.ts) —
  // o navegador carrega <img> diretamente, o servidor nunca busca essas URLs, então uma
  // allowlist de hosts aqui não escala para um catálogo mundial de editoras/lojas.
  "img-src 'self' data: https:",
  "font-src 'self'",
  "connect-src 'self' https://challenges.cloudflare.com",
  "frame-src https://challenges.cloudflare.com",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
  'upgrade-insecure-requests',
].join('; ');

export function applySecurityHeaders(headers: Headers, production: boolean): void {
  headers.set('Content-Security-Policy', CSP);
  headers.set('X-Content-Type-Options', 'nosniff');
  headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()');
  headers.set('Cross-Origin-Opener-Policy', 'same-origin');
  headers.set('X-Frame-Options', 'DENY');
  if (production) headers.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
}
