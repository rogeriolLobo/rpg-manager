import { afterEach, describe, expect, it, vi } from 'vitest';
import { isAllowedCoverUrl, isPublicHttpsUrl } from '../../src/shared/security/cover-url';
import { validateRemoteCoverImage } from '../../src/server/security/cover-images';

afterEach(() => vi.unstubAllGlobals());

describe('segurança das capas', () => {
  it('aceita apenas HTTPS público e os hosts de imagem autorizados', () => {
    expect(isAllowedCoverUrl('https://covers.openlibrary.org/b/isbn/123-L.jpg')).toBe(true);
    expect(isAllowedCoverUrl('https://cdn11.bigcommerce.com/store/product-cover.png')).toBe(true);
    expect(isAllowedCoverUrl('https://freeleaguepublishing.com/product-cover.jpg')).toBe(true);
    expect(isAllowedCoverUrl('https://greenroninstore.com/product-cover.jpg')).toBe(true);
    expect(isAllowedCoverUrl('https://pictures.abebooks.com/isbn/123-us.jpg')).toBe(true);
    expect(isAllowedCoverUrl('https://ia123456.us.archive.org/capa.jpg')).toBe(true);
    expect(isAllowedCoverUrl('https://evilus.archive.org/capa.jpg')).toBe(false);
    expect(isAllowedCoverUrl('http://covers.openlibrary.org/capa.jpg')).toBe(false);
    expect(isAllowedCoverUrl('https://example.com/capa.jpg')).toBe(false);
    expect(isAllowedCoverUrl('data:image/png;base64,abc')).toBe(false);
    expect(isAllowedCoverUrl('javascript:alert(1)')).toBe(false);
    expect(isPublicHttpsUrl('https://127.0.0.1/capa')).toBe(false);
    expect(isPublicHttpsUrl('https://192.168.1.10/capa')).toBe(false);
    expect(isPublicHttpsUrl('https://localhost/capa')).toBe(false);
    expect(isPublicHttpsUrl('https://openlibrary.org/isbn/123')).toBe(true);
  });

  it('exige resposta com Content-Type de imagem real', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('<html></html>', {
      status: 200,
      headers: { 'Content-Type': 'text/html' },
    })));
    await expect(validateRemoteCoverImage('https://covers.openlibrary.org/b/isbn/123-L.jpg')).resolves.toMatchObject({ ok: false });
  });

  it('aceita imagem e bloqueia redirecionamento para host fora da allowlist', async () => {
    const mockedFetch = vi.fn()
      .mockResolvedValueOnce(new Response('image', { status: 200, headers: { 'Content-Type': 'image/jpeg' } }))
      .mockResolvedValueOnce(new Response(null, { status: 302, headers: { Location: 'https://127.0.0.1/private.jpg' } }));
    vi.stubGlobal('fetch', mockedFetch);
    await expect(validateRemoteCoverImage('https://covers.openlibrary.org/b/isbn/123-L.jpg')).resolves.toMatchObject({ ok: true });
    await expect(validateRemoteCoverImage('https://covers.openlibrary.org/b/isbn/456-L.jpg')).resolves.toMatchObject({ ok: false });
  });
});
