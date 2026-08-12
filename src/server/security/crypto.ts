const encoder = new TextEncoder();
const PASSWORD_ITERATIONS = 600_000;

function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/u, '');
}

function fromBase64Url(value: string): Uint8Array {
  const padded = value.replaceAll('-', '+').replaceAll('_', '/').padEnd(Math.ceil(value.length / 4) * 4, '=');
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

export function randomToken(bytes = 32): string {
  return toBase64Url(crypto.getRandomValues(new Uint8Array(bytes)));
}

async function derivePassword(password: string, salt: Uint8Array, pepper = ''): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', encoder.encode(`${password}\u0000${pepper}`), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: salt.buffer as ArrayBuffer, iterations: PASSWORD_ITERATIONS },
    key,
    256,
  );
  return new Uint8Array(bits);
}

export async function hashPassword(password: string, pepper = ''): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await derivePassword(password, salt, pepper);
  return `pbkdf2-sha256$${PASSWORD_ITERATIONS}$${toBase64Url(salt)}$${toBase64Url(hash)}`;
}

function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let difference = 0;
  for (let index = 0; index < a.length; index += 1) difference |= a[index] ^ b[index];
  return difference === 0;
}

export async function verifyPassword(password: string, encodedHash: string, pepper = ''): Promise<boolean> {
  const [algorithm, iterations, saltValue, hashValue] = encodedHash.split('$');
  if (algorithm !== 'pbkdf2-sha256' || Number(iterations) !== PASSWORD_ITERATIONS || !saltValue || !hashValue) return false;
  const actual = await derivePassword(password, fromBase64Url(saltValue), pepper);
  return constantTimeEqual(actual, fromBase64Url(hashValue));
}

export async function hashSecret(secret: string, pepper = ''): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(`${secret}\u0000${pepper}`));
  return toBase64Url(new Uint8Array(digest));
}

export function normalizeEmail(email: string): string {
  return email.trim().normalize('NFKC').toLocaleLowerCase('en-US');
}

export function generateRecoveryCodes(count = 10): string[] {
  return Array.from({ length: count }, () => {
    const value = randomToken(12).toUpperCase().replaceAll('_', 'X').replaceAll('-', 'Y');
    return `RGM-${value.slice(0, 6)}-${value.slice(6, 12)}-${value.slice(12, 16)}`;
  });
}
