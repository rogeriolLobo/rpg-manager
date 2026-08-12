export interface Env {
  DB: D1Database;
  AUTH_LOGIN_RATE_LIMITER: RateLimit;
  AUTH_REGISTRATION_RATE_LIMITER: RateLimit;
  AUTH_RECOVERY_RATE_LIMITER: RateLimit;
  AUTH_SENSITIVE_RATE_LIMITER: RateLimit;
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
