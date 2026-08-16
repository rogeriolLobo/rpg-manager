// LIB-004A: fetch server-side de uma URL fornecida pelo USUÁRIO (fallback
// "Importar de uma página oficial", seção 10 do pedido) — diferente de tudo
// que existia até aqui em busca de metadata: Open Library é sempre um host
// FIXO (nunca vindo do cliente); aqui o host É o que o usuário forneceu.
// Portanto esta é a única superfície de SSRF real do domínio de metadata, e
// precisa de proteção dedicada — "não reutilizar a regra simplificada de
// <img src>" (seção 11 do pedido; ver src/shared/security/cover-url.ts, que
// só protege o QUE O NAVEGADOR carrega, nunca faz fetch no servidor).
//
// Limitação honesta e documentada (não escondida): o runtime de Workers não
// expõe uma API de resolução DNS prévia — `fetch()` resolve o host
// internamente, de forma opaca a nós. Não é possível validar o IP real de
// conexão antes do fetch acontecer (proteção completa contra DNS rebinding
// exigiria controlar a resolução, o que a plataforma não oferece). Mitigado
// em profundidade por: bloqueio de IP-literal/hostname reservado ANTES de
// cada fetch (cobre os vetores óbvios/comuns), HTTPS-only (um alvo via DNS
// rebinding ainda precisaria de um certificado TLS válido para o hostname
// usado), timeout curto, limite de tamanho de resposta, e revalidação de
// CADA redirect antes de segui-lo (nunca com `redirect:'follow'` automático).
import { ApiError } from '../http';

const TIMEOUT_MS = 5000;
const MAX_REDIRECTS = 3;
const MAX_BODY_BYTES = 2_000_000; // 2MB — suficiente para uma página de produto com JSON-LD/OpenGraph.
const ALLOWED_CONTENT_TYPES = ['text/html', 'application/xhtml+xml'];
const USER_AGENT = 'RPG-Manager/1.0 (+https://rpg-manager.editorahuginnemuninn.workers.dev; contato via GitHub rogeriolLobo/rpg-manager; import de metadata por URL, sob ação humana explícita)';

const IPV4_LITERAL = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/u;

// CIDR (início, máscara em bits) de faixas privadas/reservadas/loopback/link-local — bloqueadas.
const BLOCKED_IPV4_RANGES: Array<[string, number]> = [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16],
  ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.168.0.0', 16],
  ['198.18.0.0', 15], ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4],
  ['255.255.255.255', 32],
];

function ipv4ToInt(parts: [number, number, number, number]): number {
  return ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0;
}

function isBlockedIpv4Octets(octets: [number, number, number, number]): boolean {
  const addr = ipv4ToInt(octets);
  return BLOCKED_IPV4_RANGES.some(([base, bits]) => {
    const baseMatch = IPV4_LITERAL.exec(base)!;
    const baseAddr = ipv4ToInt(baseMatch.slice(1, 5).map(Number) as [number, number, number, number]);
    const mask = bits === 0 ? 0 : (0xFFFFFFFF << (32 - bits)) >>> 0;
    return (addr & mask) === (baseAddr & mask);
  });
}

function isBlockedIpv4(hostname: string): boolean {
  const match = IPV4_LITERAL.exec(hostname);
  if (!match) return false;
  const octets = match.slice(1, 5).map(Number);
  if (octets.some((octet) => octet > 255)) return false; // não é um IPv4 literal válido, cai para checagem de hostname.
  return isBlockedIpv4Octets(octets as [number, number, number, number]);
}

// Expansão mínima de IPv6 (só o suficiente para reconhecer os literais
// perigosos mais comuns — loopback, unspecified, link-local, unique-local,
// mapeado de IPv4). Não é um parser RFC completo; hostnames IPv6 exóticos que
// não batam aqui ainda passam pela checagem de HTTPS/timeout/tamanho como
// defesa em profundidade.
function isBlockedIpv6(hostname: string): boolean {
  const host = hostname.replace(/^\[|\]$/gu, '').toLowerCase();
  if (!host.includes(':')) return false;
  if (host === '::1' || host === '::') return true;
  if (/^fe[89ab][0-9a-f]:/u.test(host)) return true; // fe80::/10 link-local
  if (/^f[cd][0-9a-f]{2}:/u.test(host)) return true; // fc00::/7 unique-local
  if (host.startsWith('::ffff:')) {
    const mapped = host.slice('::ffff:'.length);
    // Forma decimal (::ffff:127.0.0.1) OU a forma hex em que o WHATWG URL
    // normaliza um IPv4-mapeado (::ffff:7f00:1 — dois grupos hex de 16 bits
    // codificando os mesmos 4 bytes) — ambas decodificadas para os mesmos
    // octetos antes de checar contra as faixas bloqueadas.
    if (IPV4_LITERAL.test(mapped)) return isBlockedIpv4(mapped);
    const hexGroups = /^([0-9a-f]{1,4}):([0-9a-f]{1,4})$/u.exec(mapped);
    if (hexGroups) {
      const high = Number.parseInt(hexGroups[1]!, 16); const low = Number.parseInt(hexGroups[2]!, 16);
      const octets: [number, number, number, number] = [(high >> 8) & 0xFF, high & 0xFF, (low >> 8) & 0xFF, low & 0xFF];
      return isBlockedIpv4Octets(octets);
    }
    return true; // forma não reconhecida de IPv4-mapeado — bloqueia por precaução (fail closed).
  }
  return false;
}

const BLOCKED_HOSTNAME_LITERALS = new Set(['localhost', 'metadata.google.internal']);

function isBlockedHost(hostname: string): boolean {
  const lower = hostname.toLowerCase();
  if (BLOCKED_HOSTNAME_LITERALS.has(lower) || lower.endsWith('.localhost')) return true;
  if (isBlockedIpv4(lower)) return true;
  if (isBlockedIpv6(lower)) return true;
  return false;
}

export interface ValidatedImportUrl { url: URL }

// Validação pura (sem fetch) — reaproveitada tanto antes do primeiro request
// quanto na revalidação de cada redirect (seção 11: "redirects precisam ser
// revalidados").
export function validateImportUrl(raw: string): ValidatedImportUrl {
  let url: URL;
  try { url = new URL(raw); } catch { throw new ApiError(422, 'INVALID_IMPORT_URL', 'URL inválida.'); }
  if (url.protocol !== 'https:') throw new ApiError(422, 'INVALID_IMPORT_URL', 'Use uma URL HTTPS.');
  if (url.username || url.password) throw new ApiError(422, 'INVALID_IMPORT_URL', 'A URL não pode conter credenciais.');
  if (url.port && url.port !== '443') throw new ApiError(422, 'INVALID_IMPORT_URL', 'Porta não permitida.');
  if (isBlockedHost(url.hostname)) throw new ApiError(422, 'INVALID_IMPORT_URL', 'Este endereço não pode ser importado.');
  return { url };
}

export class UrlImportError extends Error {
  constructor(public reason: 'TIMEOUT' | 'UPSTREAM_ERROR' | 'UNSUPPORTED_CONTENT_TYPE' | 'TOO_LARGE' | 'TOO_MANY_REDIRECTS', message: string) {
    super(message);
  }
}

async function readBoundedText(response: Response): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) return '';
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_BODY_BYTES) { await reader.cancel(); throw new UrlImportError('TOO_LARGE', 'Página maior que o limite permitido.'); }
    chunks.push(value);
  }
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { merged.set(chunk, offset); offset += chunk.byteLength; }
  return new TextDecoder().decode(merged);
}

// Fetch com: HTTPS-only + host bloqueado já validados por `validateImportUrl`,
// redirect manual + revalidação a cada salto (nunca `redirect:'follow'`),
// timeout, limite de tamanho de resposta, e Content-Type restrito a HTML —
// nunca tenta interpretar um binário/PDF/imagem como página de produto.
export async function fetchHtmlWithSsrfProtection(startUrl: URL): Promise<string> {
  let current = startUrl;
  for (let redirectCount = 0; redirectCount <= MAX_REDIRECTS; redirectCount += 1) {
    let response: Response;
    try {
      response = await fetch(current.toString(), {
        redirect: 'manual',
        headers: { 'User-Agent': USER_AGENT, Accept: 'text/html' },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (error) {
      if (error instanceof Error && error.name === 'TimeoutError') throw new UrlImportError('TIMEOUT', 'A página não respondeu a tempo.');
      throw new UrlImportError('UPSTREAM_ERROR', 'Falha ao acessar a página informada.');
    }
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('Location');
      if (!location) throw new UrlImportError('UPSTREAM_ERROR', 'Redirecionamento sem destino.');
      const next = validateImportUrl(new URL(location, current).toString()); // revalida o DESTINO, nunca confia no redirect cru.
      current = next.url;
      continue;
    }
    if (!response.ok) throw new UrlImportError('UPSTREAM_ERROR', `A página respondeu ${response.status}.`);
    const contentType = (response.headers.get('Content-Type') ?? '').split(';')[0]!.trim().toLowerCase();
    if (!ALLOWED_CONTENT_TYPES.includes(contentType)) throw new UrlImportError('UNSUPPORTED_CONTENT_TYPE', 'Essa página não parece ser HTML.');
    return readBoundedText(response);
  }
  throw new UrlImportError('TOO_MANY_REDIRECTS', 'Redirecionamentos demais.');
}

interface RawExtractedFields {
  jsonLd: string[];
  og: Record<string, string>;
  title?: string;
  description?: string;
}

// HTMLRewriter é a API nativa de Workers para parsing de HTML em streaming —
// nenhuma dependência nova, funciona sobre o texto já lido com limite de
// tamanho (seção 12 do pedido: "não criar scraper específico", só extração
// genérica de JSON-LD/OpenGraph/meta comuns).
async function extractRawFields(html: string): Promise<RawExtractedFields> {
  const collected: RawExtractedFields = { jsonLd: [], og: {} };
  let currentScript: string[] | null = null;
  const titleParts: string[] = [];
  const rewriter = new HTMLRewriter()
    .on('script[type="application/ld+json"]', {
      element() { currentScript = []; },
      text(chunk) {
        currentScript?.push(chunk.text);
        if (chunk.lastInTextNode && currentScript) { collected.jsonLd.push(currentScript.join('')); currentScript = null; }
      },
    })
    .on('meta[property^="og:"]', {
      element(el) {
        const prop = el.getAttribute('property'); const content = el.getAttribute('content');
        if (prop && content) collected.og[prop] = content;
      },
    })
    .on('meta[name="description"]', {
      element(el) { const content = el.getAttribute('content'); if (content) collected.description = content; },
    })
    .on('title', { text(chunk) { titleParts.push(chunk.text); } });
  const transformed = rewriter.transform(new Response(html, { headers: { 'Content-Type': 'text/html' } }));
  await transformed.text(); // drena o stream — HTMLRewriter só dispara handlers durante o consumo.
  collected.title = titleParts.join('').trim() || undefined;
  return collected;
}

export interface ImportedPageMetadata {
  title?: string; subtitle?: string; authors?: string; publisher?: string;
  publicationYear?: number; isbn?: string; coverUrl?: string; description?: string;
}

function firstString(value: unknown): string | undefined {
  if (typeof value === 'string' && value.trim()) return value.trim();
  if (Array.isArray(value)) { for (const item of value) { const found = firstString(item); if (found) return found; } }
  return undefined;
}
function authorName(value: unknown): string | undefined {
  if (typeof value === 'string') return value.trim() || undefined;
  if (Array.isArray(value)) return value.map(authorName).filter(Boolean).join(', ') || undefined;
  if (value && typeof value === 'object' && 'name' in value) return firstString((value as { name: unknown }).name);
  return undefined;
}
function yearFrom(value: unknown): number | undefined {
  const text = firstString(value);
  if (!text) return undefined;
  const match = /\b(1[0-9]{3}|20[0-9]{2})\b/u.exec(text);
  return match ? Number(match[1]) : undefined;
}
function typeIncludes(type: unknown, name: string): boolean {
  if (typeof type === 'string') return type.toLowerCase() === name;
  if (Array.isArray(type)) return type.some((t) => typeof t === 'string' && t.toLowerCase() === name);
  return false;
}

// Procura um nó Book/Product dentro de um documento JSON-LD arbitrário
// (podendo ser um objeto único, um array, ou um `@graph`) — nunca lança em
// JSON malformado, apenas ignora esse bloco.
function findBookLikeNode(parsed: unknown): Record<string, unknown> | null {
  const candidates: unknown[] = Array.isArray(parsed) ? parsed : [parsed];
  for (const candidate of candidates) {
    if (!candidate || typeof candidate !== 'object') continue;
    const node = candidate as Record<string, unknown>;
    if (typeIncludes(node['@type'], 'book') || typeIncludes(node['@type'], 'product')) return node;
    if (Array.isArray(node['@graph'])) {
      const found = findBookLikeNode(node['@graph']);
      if (found) return found;
    }
  }
  return null;
}

function extractFromJsonLd(blocks: string[]): ImportedPageMetadata | null {
  for (const block of blocks) {
    let parsed: unknown;
    try { parsed = JSON.parse(block); } catch { continue; }
    const node = findBookLikeNode(parsed);
    if (!node) continue;
    return {
      title: firstString(node.name) ?? firstString(node.headline),
      authors: authorName(node.author) ?? authorName(node.creator),
      publisher: firstString(node.publisher) ?? authorName(node.publisher),
      publicationYear: yearFrom(node.datePublished),
      isbn: firstString(node.isbn),
      coverUrl: firstString(node.image),
      description: firstString(node.description),
    };
  }
  return null;
}

function extractFromOpenGraph(og: Record<string, string>, fallbackTitle?: string, fallbackDescription?: string): ImportedPageMetadata {
  return {
    title: og['og:title'] ?? fallbackTitle,
    coverUrl: og['og:image'],
    description: og['og:description'] ?? fallbackDescription,
  };
}

// Ordem de prioridade da seção 12 do pedido: JSON-LD > OpenGraph > metadata HTML comum.
export async function extractPageMetadata(html: string): Promise<ImportedPageMetadata> {
  const raw = await extractRawFields(html);
  return extractFromJsonLd(raw.jsonLd) ?? extractFromOpenGraph(raw.og, raw.title, raw.description);
}
