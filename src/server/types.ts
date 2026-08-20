export interface Env {
  DB: D1Database;
  // LIB-005: capas enviadas pelo usuário (Zero Cost — Workers KV Free, ver
  // docs/library/COVER_STORAGE.md). Nunca usado para nada além de bytes de
  // imagem já validados/reprocessados no navegador antes do upload.
  COVERS_KV: KVNamespace;
  // F-028 (BATCH15): anexos genéricos (imagem/PDF) ligados a uma Vault Entity — mesmo
  // padrão Zero Cost de COVERS_KV, namespace próprio para não misturar o domínio de capa
  // de RPG (catálogo compartilhado) com anexos privados de entidade (owner-only).
  ASSETS_KV: KVNamespace;
  // F-031 (correção 2026-08-20): coordenador realtime de VTT — um Durable Object por Campaign
  // (SQLite-backed, Workers Free). Nunca guarda estado de domínio (isso é só D1); só conexões
  // WebSocket + contador de sequência. Ver docs/architecture/VTT_REALTIME_ZERO_COST_AUDIT.md.
  VTT_ROOMS: DurableObjectNamespace;
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
