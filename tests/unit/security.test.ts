import { describe, expect, it } from 'vitest';
import { applySecurityHeaders } from '../../src/server/security/headers';
import { generateRecoveryCodes, hashPassword, hashSecret, normalizeEmail, verifyPassword } from '../../src/server/security/crypto';

describe('segurança',()=>{
  it('normaliza e-mail de forma determinística',()=>expect(normalizeEmail('  User@EXAMPLE.com ')).toBe('user@example.com'));
  it('gera hash compatível com Workers, usa salt único e verifica a senha',async()=>{const first=await hashPassword('uma senha suficientemente longa','pepper');const second=await hashPassword('uma senha suficientemente longa','pepper');expect(first).toMatch(/^pbkdf2-sha256\$100000\$/u);expect(first).not.toBe(second);expect(await verifyPassword('uma senha suficientemente longa',first,'pepper')).toBe(true);expect(await verifyPassword('senha incorreta',first,'pepper')).toBe(false);expect(await verifyPassword('x','formato-invalido','pepper')).toBe(false);},20_000);
  it('gera códigos únicos e persiste apenas representação derivada',async()=>{const codes=generateRecoveryCodes();expect(new Set(codes).size).toBe(10);expect(codes.every(code=>code.startsWith('RGM-'))).toBe(true);expect(await hashSecret(codes[0],'pepper')).not.toContain(codes[0]);});
  it('aplica CSP por allowlist e HSTS somente em produção',()=>{const headers=new Headers();applySecurityHeaders(headers,true);const csp=headers.get('Content-Security-Policy')??'';expect(csp).toContain("frame-ancestors 'none'");expect(csp).toContain('https://covers.openlibrary.org');expect(csp).not.toContain('img-src \'self\' data: https:;');expect(headers.get('Strict-Transport-Security')).toContain('max-age=31536000');const local=new Headers();applySecurityHeaders(local,false);expect(local.has('Strict-Transport-Security')).toBe(false);});
});
