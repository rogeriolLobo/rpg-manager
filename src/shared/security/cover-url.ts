export const COVER_IMAGE_HOSTS = [
  'archive.org',
  'cdn11.bigcommerce.com',
  'cdn.vnda.com.br',
  'covers.openlibrary.org',
  'freeleaguepublishing.com',
  'greenroninstore.com',
  'i0.wp.com',
  'jamboeditora.com.br',
  'loja.retropunk.com.br',
  'luznegra.com.br',
  'modiphius.net',
  'pictures.abebooks.com',
  'vtm.paradoxwikis.com',
  'www.jamboeditora.com.br',
  'www.huginnemuninn.com.br',
] as const;

const COVER_IMAGE_HOST_SUFFIXES = ['.us.archive.org'] as const;

export const COVER_IMAGE_ORIGINS = [
  ...COVER_IMAGE_HOSTS.map((host) => `https://${host}`),
  ...COVER_IMAGE_HOST_SUFFIXES.map((suffix) => `https://*${suffix}`),
];

const allowedCoverHosts = new Set<string>(COVER_IMAGE_HOSTS);

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

export function isAllowedCoverUrl(value: string): boolean {
  const url = parsePublicHttpsUrl(value);
  if (!url) return false;
  const hostname = url.hostname.toLowerCase();
  return allowedCoverHosts.has(hostname) || COVER_IMAGE_HOST_SUFFIXES.some((suffix) => hostname.endsWith(suffix));
}
