import { isAllowedCoverUrl } from '../../shared/security/cover-url';

const MAX_REDIRECTS = 2;
const ACCEPTED_IMAGE_TYPES = new Set(['image/avif', 'image/gif', 'image/jpeg', 'image/png', 'image/webp']);

export type CoverValidationResult =
  | { ok: true; contentType: string }
  | { ok: false; message: string };

export async function validateRemoteCoverImage(url: string, redirects = 0): Promise<CoverValidationResult> {
  if (!isAllowedCoverUrl(url)) {
    return { ok: false, message: 'A URL da capa deve usar HTTPS e um domínio de imagens autorizado.' };
  }

  let response: Response;
  try {
    response = await fetch(url, {
      method: 'GET',
      redirect: 'manual',
      signal: AbortSignal.timeout(10_000),
      headers: {
        Accept: 'image/avif,image/webp,image/png,image/jpeg,image/gif',
        Range: 'bytes=0-1023',
      },
    });
  } catch {
    return { ok: false, message: 'Não foi possível acessar a imagem da capa.' };
  }

  if (response.status >= 300 && response.status < 400) {
    response.body?.cancel().catch(() => undefined);
    const location = response.headers.get('Location');
    if (!location || redirects >= MAX_REDIRECTS) return { ok: false, message: 'A imagem da capa excedeu o limite de redirecionamentos.' };
    const redirectedUrl = new URL(location, url).toString();
    return validateRemoteCoverImage(redirectedUrl, redirects + 1);
  }

  const contentType = response.headers.get('Content-Type')?.split(';', 1)[0]?.trim().toLowerCase() ?? '';
  response.body?.cancel().catch(() => undefined);
  if (!response.ok) return { ok: false, message: `A imagem da capa respondeu com HTTP ${response.status}.` };
  if (!ACCEPTED_IMAGE_TYPES.has(contentType)) return { ok: false, message: 'O endereço da capa não retornou um formato de imagem aceito.' };
  return { ok: true, contentType };
}
