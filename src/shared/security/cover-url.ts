// Política de coverUrl: o valor é usado SOMENTE pelo navegador como <img src>
// (com fallback em onError — ver CoverImage em library-pages.tsx) — o servidor
// nunca busca essa URL. Por isso a única validação necessária aqui é sintática/
// de protocolo/anti-SSRF-por-IP-literal, sem allowlist fixa de hosts: uma
// allowlist de editoras não escala para um catálogo mundial de RPGs (LIB-001).
//
// Se, no futuro, algum fluxo passar a exigir que o SERVIDOR busque uma URL
// remota (ex.: reprocessar uma imagem enviada por URL), essa rota deve aplicar
// sua própria validação dedicada — não reutilizar esta função para isso.
function hasUnsafeHostname(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/gu, '');
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')) return true;
  if (host.includes(':')) return true;

  const parts = host.split('.');
  if (parts.length !== 4 || parts.some((part) => !/^\d{1,3}$/u.test(part))) return false;
  const octets = parts.map(Number);
  if (octets.some((octet) => octet > 255)) return true;
  const [first, second] = octets;
  return first === 0 || first === 10 || first === 127 || first >= 224
    || (first === 100 && second >= 64 && second <= 127)
    || (first === 169 && second === 254)
    || (first === 172 && second >= 16 && second <= 31)
    || (first === 192 && second === 168)
    || (first === 198 && (second === 18 || second === 19));
}

export function parsePublicHttpsUrl(value: string): URL | null {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || url.port || hasUnsafeHostname(url.hostname)) return null;
    return url;
  } catch {
    return null;
  }
}

export function isPublicHttpsUrl(value: string): boolean {
  return parsePublicHttpsUrl(value) !== null;
}
