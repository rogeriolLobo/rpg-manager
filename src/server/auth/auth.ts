import type { Context, Next } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { z } from "zod";
import {
  changePasswordSchema,
  deleteAccountSchema,
  loginSchema,
  recoverSchema,
  registerSchema,
} from "../../shared/validation/schemas";
import { ApiError, nowIso, readJson } from "../http";
import type { AppVariables, Env } from "../types";
import {
  generateRecoveryCodes,
  hashPassword,
  hashSecret,
  normalizeEmail,
  randomToken,
  verifyPassword,
} from "../security/crypto";
import { verifyTurnstile } from "../security/turnstile";

type AppContext = Context<{ Bindings: Env; Variables: AppVariables }>;
const SESSION_SECONDS = 60 * 60 * 24 * 7;
const cookieOptions = (c: AppContext, httpOnly: boolean) => ({
  httpOnly,
  secure: new URL(c.req.url).protocol === "https:",
  sameSite: "Lax" as const,
  path: "/",
  maxAge: SESSION_SECONDS,
});

interface SessionRow {
  session_id: string;
  user_id: string;
  email: string;
  display_name: string;
  last_seen_at: string;
}

function setSessionCookies(
  c: AppContext,
  token: string,
  csrfToken: string,
): void {
  setCookie(c, "rpg_session", token, cookieOptions(c, true));
  setCookie(c, "rpg_csrf", csrfToken, cookieOptions(c, false));
}

function clearSessionCookies(c: AppContext): void {
  deleteCookie(c, "rpg_session", {
    path: "/",
    secure: new URL(c.req.url).protocol === "https:",
  });
  deleteCookie(c, "rpg_csrf", {
    path: "/",
    secure: new URL(c.req.url).protocol === "https:",
  });
}

function clientIp(c: AppContext): string {
  return c.req.header("CF-Connecting-IP") ?? "local";
}
function summarizedUserAgent(c: AppContext): string {
  return (c.req.header("User-Agent") ?? "").slice(0, 300);
}

async function newSession(env: Env, userId: string, userAgent: string) {
  const token = randomToken();
  const csrfToken = randomToken(24);
  const now = nowIso();
  return {
    id: crypto.randomUUID(),
    token,
    csrfToken,
    tokenHash: await hashSecret(token, env.PASSWORD_PEPPER),
    now,
    expiresAt: new Date(Date.now() + SESSION_SECONDS * 1000).toISOString(),
    userAgent,
    statement: env.DB.prepare(`INSERT INTO auth_sessions
      (id,user_id,token_hash,created_at,last_seen_at,expires_at,user_agent) VALUES (?,?,?,?,?,?,?)`),
    userId,
  };
}

function sessionInsert(
  session: Awaited<ReturnType<typeof newSession>>,
): D1PreparedStatement {
  return session.statement.bind(
    session.id,
    session.userId,
    session.tokenHash,
    session.now,
    session.now,
    session.expiresAt,
    session.userAgent,
  );
}

async function securityEvent(
  env: Env,
  userId: string | null,
  type: string,
  requestId: string,
  context: Record<string, unknown> = {},
) {
  return env.DB.prepare(
    `INSERT INTO security_events (id,user_id,event_type,occurred_at,request_id,context) VALUES (?,?,?,?,?,?)`,
  ).bind(
    crypto.randomUUID(),
    userId,
    type,
    nowIso(),
    requestId,
    JSON.stringify(context),
  );
}

async function authStage<T>(
  c: AppContext,
  stage: string,
  operation: () => Promise<T>,
): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    console.error(
      JSON.stringify({
        level: "error",
        requestId: c.get("requestId"),
        operation: "AUTH_REGISTER",
        stage,
        errorName: error instanceof Error ? error.name : "UnknownError",
        message: error instanceof Error ? error.message : "Unknown error",
      }),
    );
    throw error;
  }
}

async function enforceRateLimit(
  c: AppContext,
  normalizedEmail: string,
  limiter: RateLimit = c.env.AUTH_LOGIN_RATE_LIMITER,
): Promise<number> {
  const ipKey = await hashSecret(`ip:${clientIp(c)}`, c.env.PASSWORD_PEPPER);
  const accountKey = await hashSecret(
    `account:${normalizedEmail}`,
    c.env.PASSWORD_PEPPER,
  );
  const [ipLimit, accountLimit] = await Promise.all([
    limiter.limit({ key: ipKey }),
    limiter.limit({ key: accountKey }),
  ]);
  if (!ipLimit.success || !accountLimit.success)
    throw new ApiError(
      429,
      "RATE_LIMITED",
      "Muitas tentativas. Aguarde antes de tentar novamente.",
    );
  const row = await c.env.DB.prepare(
    "SELECT failed_attempts, blocked_until FROM auth_rate_limits WHERE key_hash = ?",
  )
    .bind(accountKey)
    .first<{ failed_attempts: number; blocked_until: string | null }>();
  if (row?.blocked_until && row.blocked_until > nowIso())
    throw new ApiError(
      429,
      "RATE_LIMITED",
      "Muitas tentativas. Aguarde antes de tentar novamente.",
    );
  return row?.failed_attempts ?? 0;
}

async function recordFailure(
  c: AppContext,
  normalizedEmail: string,
): Promise<void> {
  const key = await hashSecret(
    `account:${normalizedEmail}`,
    c.env.PASSWORD_PEPPER,
  );
  const existing = await c.env.DB.prepare(
    "SELECT failed_attempts FROM auth_rate_limits WHERE key_hash = ?",
  )
    .bind(key)
    .first<{ failed_attempts: number }>();
  const failures = (existing?.failed_attempts ?? 0) + 1;
  const delaySeconds =
    failures < 3 ? 0 : Math.min(900, 2 ** Math.min(failures, 10));
  await c.env.DB.prepare(
    `INSERT INTO auth_rate_limits (key_hash,failed_attempts,window_started_at,blocked_until)
    VALUES (?,?,?,?) ON CONFLICT(key_hash) DO UPDATE SET failed_attempts=excluded.failed_attempts, blocked_until=excluded.blocked_until`,
  )
    .bind(
      key,
      failures,
      nowIso(),
      delaySeconds
        ? new Date(Date.now() + delaySeconds * 1000).toISOString()
        : null,
    )
    .run();
}

async function clearFailures(env: Env, normalizedEmail: string): Promise<void> {
  const key = await hashSecret(
    `account:${normalizedEmail}`,
    env.PASSWORD_PEPPER,
  );
  await env.DB.prepare("DELETE FROM auth_rate_limits WHERE key_hash = ?")
    .bind(key)
    .run();
}

export async function requireAuth(
  c: AppContext,
  next: Next,
): Promise<Response | void> {
  const token = getCookie(c, "rpg_session");
  if (!token)
    return c.json(
      {
        error: { code: "UNAUTHENTICATED", message: "Autenticação necessária." },
      },
      401,
    );
  const tokenHash = await hashSecret(token, c.env.PASSWORD_PEPPER);
  const row = await c.env.DB.prepare(
    `SELECT s.id session_id,s.last_seen_at,u.id user_id,u.email,u.display_name
    FROM auth_sessions s JOIN users u ON u.id=s.user_id
    WHERE s.token_hash=? AND s.revoked_at IS NULL AND s.expires_at>? AND u.disabled_at IS NULL AND u.deleted_at IS NULL`,
  )
    .bind(tokenHash, nowIso())
    .first<SessionRow>();
  if (!row) {
    clearSessionCookies(c);
    return c.json(
      {
        error: {
          code: "UNAUTHENTICATED",
          message: "Sessão inválida ou expirada.",
        },
      },
      401,
    );
  }
  c.set("user", {
    id: row.user_id,
    email: row.email,
    displayName: row.display_name,
    sessionId: row.session_id,
  });
  if (Date.now() - new Date(row.last_seen_at).getTime() > 15 * 60_000) {
    await c.env.DB.prepare(
      "UPDATE auth_sessions SET last_seen_at=? WHERE id=? AND user_id=?",
    )
      .bind(nowIso(), row.session_id, row.user_id)
      .run();
  }
  return next();
}

export async function register(c: AppContext): Promise<Response> {
  const input = await readJson(c, registerSchema);
  const normalizedEmail = normalizeEmail(input.email);
  await authStage(c, "rate-limit", () =>
    enforceRateLimit(
      c,
      normalizedEmail,
      c.env.AUTH_REGISTRATION_RATE_LIMITER,
    ),
  );
  if (
    !(await authStage(c, "turnstile", () =>
      verifyTurnstile(c.env, input.turnstileToken, clientIp(c)),
    ))
  )
    throw new ApiError(
      403,
      "TURNSTILE_REQUIRED",
      "Não foi possível validar a proteção contra bots.",
    );
  const existing = await authStage(c, "account-lookup", () =>
    c.env.DB.prepare("SELECT id FROM users WHERE email_normalized=?")
      .bind(normalizedEmail)
      .first(),
  );
  if (existing) {
    await hashPassword(input.password, c.env.PASSWORD_PEPPER);
    throw new ApiError(
      409,
      "ACCOUNT_UNAVAILABLE",
      "Não foi possível criar a conta com os dados informados.",
    );
  }
  const userId = crypto.randomUUID();
  const passwordHash = await authStage(c, "password-hash", () =>
    hashPassword(input.password, c.env.PASSWORD_PEPPER),
  );
  const codes = generateRecoveryCodes();
  const session = await authStage(c, "session-create", () =>
    newSession(c.env, userId, summarizedUserAgent(c)),
  );
  const codeHashes = await authStage(c, "recovery-code-hash", () =>
    Promise.all(
      codes.map((code) => hashSecret(code, c.env.PASSWORD_PEPPER)),
    ),
  );
  const statements: D1PreparedStatement[] = [
    c.env.DB.prepare(
      `INSERT INTO users (id,email,email_normalized,display_name,password_hash,created_at,updated_at,password_changed_at)
      VALUES (?,?,?,?,?,?,?,?)`,
    ).bind(
      userId,
      input.email.trim(),
      normalizedEmail,
      input.displayName,
      passwordHash,
      session.now,
      session.now,
      session.now,
    ),
    c.env.DB.prepare(
      "INSERT INTO user_preferences (user_id,updated_at) VALUES (?,?)",
    ).bind(userId, session.now),
    sessionInsert(session),
  ];
  for (const codeHash of codeHashes)
    statements.push(
      c.env.DB.prepare(
        "INSERT INTO account_recovery_codes (id,user_id,code_hash,created_at) VALUES (?,?,?,?)",
      ).bind(
        crypto.randomUUID(),
        userId,
        codeHash,
        session.now,
      ),
    );
  statements.push(
    await securityEvent(c.env, userId, "ACCOUNT_CREATED", c.get("requestId")),
  );
  await authStage(c, "database-commit", () => c.env.DB.batch(statements));
  setSessionCookies(c, session.token, session.csrfToken);
  return c.json(
    {
      user: {
        id: userId,
        email: input.email.trim(),
        displayName: input.displayName,
      },
      recoveryCodes: codes,
    },
    201,
  );
}

export async function login(c: AppContext): Promise<Response> {
  const input = await readJson(c, loginSchema);
  const normalizedEmail = normalizeEmail(input.email);
  const failures = await enforceRateLimit(c, normalizedEmail);
  if (
    failures >= 3 &&
    !(await verifyTurnstile(c.env, input.turnstileToken, clientIp(c)))
  )
    throw new ApiError(
      403,
      "TURNSTILE_REQUIRED",
      "Confirme que você não é um robô.",
    );
  const user = await c.env.DB.prepare(
    `SELECT id,email,display_name,password_hash FROM users
    WHERE email_normalized=? AND disabled_at IS NULL AND deleted_at IS NULL`,
  )
    .bind(normalizedEmail)
    .first<{
      id: string;
      email: string;
      display_name: string;
      password_hash: string;
    }>();
  const valid = user
    ? await verifyPassword(
        input.password,
        user.password_hash,
        c.env.PASSWORD_PEPPER,
      )
    : await hashPassword(input.password, c.env.PASSWORD_PEPPER).then(
        () => false,
      );
  if (!user || !valid) {
    await recordFailure(c, normalizedEmail);
    await (
      await securityEvent(
        c.env,
        user?.id ?? null,
        "LOGIN_FAILED",
        c.get("requestId"),
      )
    ).run();
    throw new ApiError(
      401,
      "INVALID_CREDENTIALS",
      "E-mail ou senha inválidos.",
    );
  }
  const session = await newSession(c.env, user.id, summarizedUserAgent(c));
  await c.env.DB.batch([
    sessionInsert(session),
    await securityEvent(c.env, user.id, "LOGIN_SUCCESS", c.get("requestId")),
  ]);
  await clearFailures(c.env, normalizedEmail);
  setSessionCookies(c, session.token, session.csrfToken);
  return c.json({
    user: { id: user.id, email: user.email, displayName: user.display_name },
  });
}

export async function session(c: AppContext): Promise<Response> {
  return c.json({ user: c.get("user") });
}

export async function logout(c: AppContext): Promise<Response> {
  const user = c.get("user");
  await c.env.DB.batch([
    c.env.DB.prepare(
      "UPDATE auth_sessions SET revoked_at=? WHERE id=? AND user_id=?",
    ).bind(nowIso(), user.sessionId, user.id),
    await securityEvent(c.env, user.id, "SESSION_REVOKED", c.get("requestId"), {
      scope: "current",
    }),
  ]);
  clearSessionCookies(c);
  return c.json({ success: true });
}

export async function logoutAll(c: AppContext): Promise<Response> {
  const user = c.get("user");
  await c.env.DB.batch([
    c.env.DB.prepare(
      "UPDATE auth_sessions SET revoked_at=? WHERE user_id=? AND revoked_at IS NULL",
    ).bind(nowIso(), user.id),
    await securityEvent(c.env, user.id, "SESSION_REVOKED", c.get("requestId"), {
      scope: "all",
    }),
  ]);
  clearSessionCookies(c);
  return c.json({ success: true });
}

export async function listSessions(c: AppContext): Promise<Response> {
  const user = c.get("user");
  const rows = await c.env.DB.prepare(
    `SELECT id,created_at,last_seen_at,expires_at,user_agent FROM auth_sessions
    WHERE user_id=? AND revoked_at IS NULL AND expires_at>? ORDER BY created_at DESC`,
  )
    .bind(user.id, nowIso())
    .all();
  return c.json({
    sessions: rows.results.map((row) => ({
      ...row,
      current: row.id === user.sessionId,
    })),
  });
}

export async function revokeSession(c: AppContext): Promise<Response> {
  const user = c.get("user");
  const id = c.req.param("id");
  const result = await c.env.DB.prepare(
    "UPDATE auth_sessions SET revoked_at=? WHERE id=? AND user_id=? AND revoked_at IS NULL",
  )
    .bind(nowIso(), id, user.id)
    .run();
  if (!result.meta.changes)
    throw new ApiError(404, "NOT_FOUND", "Sessão não encontrada.");
  await (
    await securityEvent(c.env, user.id, "SESSION_REVOKED", c.get("requestId"), {
      current: id === user.sessionId,
    })
  ).run();
  if (id === user.sessionId) clearSessionCookies(c);
  return c.json({ success: true });
}

export async function changePassword(c: AppContext): Promise<Response> {
  const input = await readJson(c, changePasswordSchema);
  const user = c.get("user");
  await enforceRateLimit(c, normalizeEmail(user.email), c.env.AUTH_SENSITIVE_RATE_LIMITER);
  const row = await c.env.DB.prepare(
    "SELECT password_hash FROM users WHERE id=?",
  )
    .bind(user.id)
    .first<{ password_hash: string }>();
  if (
    !row ||
    !(await verifyPassword(
      input.currentPassword,
      row.password_hash,
      c.env.PASSWORD_PEPPER,
    ))
  )
    throw new ApiError(401, "INVALID_CREDENTIALS", "Senha atual inválida.");
  if (input.currentPassword === input.newPassword)
    throw new ApiError(
      422,
      "PASSWORD_REUSED",
      "A nova senha deve ser diferente da atual.",
    );
  const passwordHash = await hashPassword(
    input.newPassword,
    c.env.PASSWORD_PEPPER,
  );
  const replacement = await newSession(c.env, user.id, summarizedUserAgent(c));
  const revokeSql = input.revokeOtherSessions
    ? "UPDATE auth_sessions SET revoked_at=? WHERE user_id=? AND revoked_at IS NULL"
    : "UPDATE auth_sessions SET revoked_at=? WHERE id=? AND user_id=?";
  const revoke = input.revokeOtherSessions
    ? c.env.DB.prepare(revokeSql).bind(replacement.now, user.id)
    : c.env.DB.prepare(revokeSql).bind(
        replacement.now,
        user.sessionId,
        user.id,
      );
  await c.env.DB.batch([
    c.env.DB.prepare(
      "UPDATE users SET password_hash=?,password_changed_at=?,updated_at=? WHERE id=?",
    ).bind(passwordHash, replacement.now, replacement.now, user.id),
    revoke,
    sessionInsert(replacement),
    await securityEvent(
      c.env,
      user.id,
      "PASSWORD_CHANGED",
      c.get("requestId"),
      { revokedOthers: input.revokeOtherSessions },
    ),
  ]);
  setSessionCookies(c, replacement.token, replacement.csrfToken);
  return c.json({ success: true });
}

export async function recover(c: AppContext): Promise<Response> {
  const input = await readJson(c, recoverSchema);
  const normalizedEmail = normalizeEmail(input.email);
  await enforceRateLimit(c, normalizedEmail, c.env.AUTH_RECOVERY_RATE_LIMITER);
  if (!(await verifyTurnstile(c.env, input.turnstileToken, clientIp(c))))
    throw new ApiError(
      403,
      "TURNSTILE_REQUIRED",
      "Não foi possível validar a proteção contra bots.",
    );
  const user = await c.env.DB.prepare(
    "SELECT id,email,display_name FROM users WHERE email_normalized=? AND deleted_at IS NULL",
  )
    .bind(normalizedEmail)
    .first<{ id: string; email: string; display_name: string }>();
  const codeHash = await hashSecret(
    input.recoveryCode.trim().toUpperCase(),
    c.env.PASSWORD_PEPPER,
  );
  const code = user
    ? await c.env.DB.prepare(
        "SELECT id FROM account_recovery_codes WHERE user_id=? AND code_hash=? AND used_at IS NULL",
      )
        .bind(user.id, codeHash)
        .first<{ id: string }>()
    : null;
  if (!user || !code) {
    await recordFailure(c, normalizedEmail);
    throw new ApiError(
      401,
      "RECOVERY_FAILED",
      "Não foi possível recuperar a conta com os dados informados.",
    );
  }
  const passwordHash = await hashPassword(
    input.newPassword,
    c.env.PASSWORD_PEPPER,
  );
  const replacement = await newSession(c.env, user.id, summarizedUserAgent(c));
  await c.env.DB.batch([
    c.env.DB.prepare(
      "UPDATE account_recovery_codes SET used_at=? WHERE id=? AND used_at IS NULL",
    ).bind(replacement.now, code.id),
    c.env.DB.prepare(
      "UPDATE users SET password_hash=?,password_changed_at=?,updated_at=? WHERE id=?",
    ).bind(passwordHash, replacement.now, replacement.now, user.id),
    c.env.DB.prepare(
      "UPDATE auth_sessions SET revoked_at=? WHERE user_id=? AND revoked_at IS NULL",
    ).bind(replacement.now, user.id),
    sessionInsert(replacement),
    await securityEvent(
      c.env,
      user.id,
      "RECOVERY_CODE_USED",
      c.get("requestId"),
    ),
  ]);
  await clearFailures(c.env, normalizedEmail);
  setSessionCookies(c, replacement.token, replacement.csrfToken);
  return c.json({
    user: { id: user.id, email: user.email, displayName: user.display_name },
  });
}

export async function deleteAccount(c: AppContext): Promise<Response> {
  const input = await readJson(c, deleteAccountSchema);
  const user = c.get("user");
  const row = await c.env.DB.prepare(
    "SELECT password_hash FROM users WHERE id=?",
  )
    .bind(user.id)
    .first<{ password_hash: string }>();
  if (
    !row ||
    !(await verifyPassword(
      input.currentPassword,
      row.password_hash,
      c.env.PASSWORD_PEPPER,
    ))
  )
    throw new ApiError(401, "INVALID_CREDENTIALS", "Senha atual inválida.");
  const event = await securityEvent(
    c.env,
    user.id,
    "ACCOUNT_DELETED",
    c.get("requestId"),
  );
  const now = nowIso();
  const tombstoneEmail = `deleted+${crypto.randomUUID()}@invalid.local`;
  const tombstonePassword = await hashPassword(
    randomToken(32),
    c.env.PASSWORD_PEPPER,
  );
  await c.env.DB.batch([
    event,
    c.env.DB.prepare("DELETE FROM auth_sessions WHERE user_id=?").bind(user.id),
    c.env.DB.prepare("DELETE FROM account_recovery_codes WHERE user_id=?").bind(
      user.id,
    ),
    c.env.DB.prepare(
      `UPDATE users SET email=?,email_normalized=?,display_name='Conta excluída',password_hash=?,
        password_changed_at=?,disabled_at=?,deleted_at=?,updated_at=? WHERE id=?`,
    ).bind(
      tombstoneEmail,
      tombstoneEmail,
      tombstonePassword,
      now,
      now,
      now,
      now,
      user.id,
    ),
  ]);
  clearSessionCookies(c);
  return c.json({ success: true });
}

export const revokeParamsSchema = z.object({ id: z.string().uuid() });
