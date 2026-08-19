export interface Env {
  DB: D1Database;
  // LIB-005: capas enviadas pelo usuário (Zero Cost — Workers KV Free, ver
  // docs/library/COVER_STORAGE.md). Nunca usado para nada além de bytes de
  // imagem já validados/reprocessados no navegador antes do upload.
  COVERS_KV: KVNamespace;
  AUTH_LOGIN_RATE_LIMITER: RateLimit;
  AUTH_REGISTRATION_RATE_LIMITER: RateLimit;
  AUTH_RECOVERY_RATE_LIMITER: RateLimit;
  AUTH_SENSITIVE_RATE_LIMITER: RateLimit;
  DIRECTORY_RATE_LIMITER: RateLimit;
  SOCIAL_RATE_LIMITER: RateLimit;
  PASSWORD_PEPPER?: string;
  TURNSTILE_SECRET_KEY?: string;
  ENVIRONMENT?: string;
}

export interface AuthenticatedUser {
  id: string;
  email: string;
  displayName: string;
  sessionId: string;
}

export type AppVariables = {
  requestId: string;
  user: AuthenticatedUser;
};
