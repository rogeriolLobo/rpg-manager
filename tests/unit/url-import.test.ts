import { describe, expect, it } from 'vitest';
import { validateImportUrl } from '../../src/server/security/url-import';

// LIB-004A: importação de URL fornecida pelo usuário é a única superfície de
// SSRF real do domínio de metadata (host não é fixo) — ver seção 11 do
// pedido. Testes cobrem só a validação PURA (sem fetch/HTMLRewriter, que
// exigem o runtime real de Workers — ver tests/integration/url-import.test.ts).
describe('validateImportUrl — SSRF (LIB-004A)', () => {
  it('aceita HTTPS público comum', () => {
    expect(() => validateImportUrl('https://www.pelgranepress.com/product/trail-of-cthulhu/')).not.toThrow();
  });

  it('rejeita HTTP (não-HTTPS)', () => {
    expect(() => validateImportUrl('http://example.com/produto')).toThrow();
  });

  it('rejeita protocolos exóticos', () => {
    expect(() => validateImportUrl('ftp://example.com/produto')).toThrow();
    expect(() => validateImportUrl('file:///etc/passwd')).toThrow();
    expect(() => validateImportUrl('javascript:alert(1)')).toThrow();
  });

  it('rejeita URL com credenciais embutidas', () => {
    expect(() => validateImportUrl('https://user:pass@example.com/produto')).toThrow();
  });

  it('rejeita porta não padrão', () => {
    expect(() => validateImportUrl('https://example.com:8080/produto')).toThrow();
  });

  it('aceita porta 443 explícita (equivalente ao padrão)', () => {
    expect(() => validateImportUrl('https://example.com:443/produto')).not.toThrow();
  });

  it('rejeita localhost e variantes', () => {
    expect(() => validateImportUrl('https://localhost/produto')).toThrow();
    expect(() => validateImportUrl('https://sub.localhost/produto')).toThrow();
  });

  it('rejeita loopback IPv4 (127.0.0.1)', () => {
    expect(() => validateImportUrl('https://127.0.0.1/produto')).toThrow();
    expect(() => validateImportUrl('https://127.0.0.5/produto')).toThrow();
  });

  it('rejeita faixas privadas IPv4 (RFC1918)', () => {
    expect(() => validateImportUrl('https://10.0.0.5/x')).toThrow();
    expect(() => validateImportUrl('https://172.16.0.5/x')).toThrow();
    expect(() => validateImportUrl('https://192.168.1.1/x')).toThrow();
  });

  it('rejeita link-local IPv4 (169.254.0.0/16 — inclui metadata de cloud, ex.: 169.254.169.254)', () => {
    expect(() => validateImportUrl('https://169.254.169.254/latest/meta-data')).toThrow();
  });

  it('rejeita CGNAT (100.64.0.0/10) e faixas reservadas/documentação', () => {
    expect(() => validateImportUrl('https://100.64.0.1/x')).toThrow();
    expect(() => validateImportUrl('https://192.0.2.1/x')).toThrow();
    expect(() => validateImportUrl('https://198.51.100.1/x')).toThrow();
  });

  it('rejeita loopback/link-local/unique-local IPv6', () => {
    expect(() => validateImportUrl('https://[::1]/x')).toThrow();
    expect(() => validateImportUrl('https://[fe80::1]/x')).toThrow();
    expect(() => validateImportUrl('https://[fc00::1]/x')).toThrow();
    expect(() => validateImportUrl('https://[fd12:3456::1]/x')).toThrow();
  });

  it('rejeita IPv4 mapeado em IPv6 apontando para faixa bloqueada (o parser WHATWG normaliza para forma hex — ::ffff:7f00:1 = 127.0.0.1)', () => {
    expect(() => validateImportUrl('https://[::ffff:127.0.0.1]/x')).toThrow();
    expect(new URL('https://[::ffff:127.0.0.1]/x').hostname).toBe('[::ffff:7f00:1]'); // confirma a normalização que a checagem precisa decodificar
    expect(() => validateImportUrl('https://[::ffff:7f00:1]/x')).toThrow();
  });

  it('aceita IPv4 mapeado em IPv6 apontando para um IP público real (Google DNS 8.8.8.8 = ::ffff:0808:0808)', () => {
    expect(() => validateImportUrl('https://[::ffff:8.8.8.8]/x')).not.toThrow();
  });

  it('aceita hostname público comum com IPv6 público (não bloqueado por engano)', () => {
    expect(() => validateImportUrl('https://[2001:4860:4860::8888]/x')).not.toThrow();
  });

  it('rejeita URL malformada', () => {
    expect(() => validateImportUrl('não é uma url')).toThrow();
    expect(() => validateImportUrl('')).toThrow();
  });
});
