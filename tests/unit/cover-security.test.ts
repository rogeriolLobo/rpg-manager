import { describe, expect, it } from 'vitest';
import { isPublicHttpsUrl } from '../../src/shared/security/cover-url';

// coverUrl é usada só pelo navegador como <img src> — o servidor nunca busca essa URL
// (ver src/shared/security/cover-url.ts), então não existe allowlist de hosts. A única
// política é sintática: HTTPS público, sem credenciais/porta, sem IP privado/loopback,
// sem protocolo perigoso (javascript:, data:, file:, ftp:).
describe('segurança das capas (LIB-001: URL externa, sem fetch do servidor)', () => {
  it('aceita qualquer host HTTPS público, sem allowlist', () => {
    expect(isPublicHttpsUrl('https://covers.openlibrary.org/b/isbn/123-L.jpg')).toBe(true);
    expect(isPublicHttpsUrl('https://devir.com.br/wp-content/uploads/2022/08/imagem-destaque-site-1-2-780x654.png')).toBe(true);
    expect(isPublicHttpsUrl('https://exemplo-nunca-visto-antes.com.br/capa.jpg')).toBe(true);
    expect(isPublicHttpsUrl('https://encrypted-tbn2.gstatic.com/shopping?q=tbn:abc')).toBe(true);
  });

  it('rejeita protocolo não-HTTPS ou perigoso', () => {
    expect(isPublicHttpsUrl('http://covers.openlibrary.org/capa.jpg')).toBe(false);
    expect(isPublicHttpsUrl('data:image/png;base64,abc')).toBe(false);
    expect(isPublicHttpsUrl('javascript:alert(1)')).toBe(false);
    expect(isPublicHttpsUrl('file:///etc/passwd')).toBe(false);
    expect(isPublicHttpsUrl('ftp://exemplo.com/capa.jpg')).toBe(false);
  });

  it('rejeita credenciais e porta embutidas na URL', () => {
    expect(isPublicHttpsUrl('https://user:pass@exemplo.com/capa.jpg')).toBe(false);
    expect(isPublicHttpsUrl('https://exemplo.com:8443/capa.jpg')).toBe(false);
  });

  it('rejeita loopback, hosts locais e IP privado/reservado literal', () => {
    expect(isPublicHttpsUrl('https://127.0.0.1/capa')).toBe(false);
    expect(isPublicHttpsUrl('https://localhost/capa')).toBe(false);
    expect(isPublicHttpsUrl('https://algo.localhost/capa')).toBe(false);
    expect(isPublicHttpsUrl('https://algo.internal/capa')).toBe(false);
    expect(isPublicHttpsUrl('https://192.168.1.10/capa')).toBe(false);
    expect(isPublicHttpsUrl('https://10.0.0.5/capa')).toBe(false);
    expect(isPublicHttpsUrl('https://169.254.1.1/capa')).toBe(false);
    expect(isPublicHttpsUrl('https://172.16.0.1/capa')).toBe(false);
  });

  it('aceita URL pública normal', () => {
    expect(isPublicHttpsUrl('https://openlibrary.org/isbn/123')).toBe(true);
  });
});
