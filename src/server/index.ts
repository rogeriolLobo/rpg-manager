import { Hono } from 'hono';
import { changePassword, deleteAccount, listSessions, login, logout, logoutAll, recover, register, requireAuth, revokeSession, session } from './auth/auth';
import { ApiError } from './http';
import { requireCsrf, requireTrustedOrigin } from './security/csrf';
import { applySecurityHeaders } from './security/headers';
import { campaignRoutes } from './routes/campaigns';
import { dashboardRoutes } from './routes/dashboard';
import { rpgRoutes } from './routes/rpgs';
import { transferRoutes } from './routes/transfer';
import { groupRoutes } from './routes/groups';
import type { AppVariables, Env } from './types';
import { profileSchema } from '../shared/validation/schemas';
import { readJson } from './http';

const app = new Hono<{ Bindings: Env; Variables: AppVariables }>();

app.use('*', async (c, next) => {
  const requestId = c.req.header('CF-Ray') ?? crypto.randomUUID(); c.set('requestId', requestId); const started = Date.now();
  try { await next(); } finally {
    applySecurityHeaders(c.res.headers, c.env.ENVIRONMENT === 'production' || new URL(c.req.url).protocol === 'https:');
    c.res.headers.set('X-Request-Id', requestId);
    console.info(JSON.stringify({ level: 'info', requestId, method: c.req.method, route: new URL(c.req.url).pathname, status: c.res.status, durationMs: Date.now() - started }));
  }
});
app.use('/api/*', requireTrustedOrigin);
app.get('/api/v1/health', (c) => c.json({ status: 'ok' }));
app.post('/api/v1/auth/register', register);
app.post('/api/v1/auth/login', login);
app.post('/api/v1/auth/recover', recover);
app.use('/api/v1/auth/session', requireAuth);
app.get('/api/v1/auth/session', session);
app.use('/api/v1/auth/*', requireAuth, requireCsrf);
app.post('/api/v1/auth/logout', logout);
app.post('/api/v1/auth/logout-all', logoutAll);
app.get('/api/v1/auth/sessions', listSessions);
app.delete('/api/v1/auth/sessions/:id', revokeSession);
app.post('/api/v1/auth/change-password', changePassword);
app.delete('/api/v1/auth/account', deleteAccount);
app.get('/api/v1/profile', requireAuth, (c) => c.json({ user: c.get('user') }));
app.patch('/api/v1/profile', requireAuth, requireCsrf, async (c) => {
  const input = await readJson(c, profileSchema); const user = c.get('user');
  await c.env.DB.prepare('UPDATE users SET display_name=?,updated_at=? WHERE id=?').bind(input.displayName, new Date().toISOString(), user.id).run();
  return c.json({ user: { ...user, displayName: input.displayName } });
});
app.use('/api/v1/rpgs/*', requireAuth, requireCsrf);
app.use('/api/v1/rpgs', requireAuth, requireCsrf);
app.route('/api/v1/rpgs', rpgRoutes);
app.use('/api/v1/campaigns/*', requireAuth, requireCsrf);
app.use('/api/v1/campaigns', requireAuth, requireCsrf);
app.route('/api/v1/campaigns', campaignRoutes);
app.use('/api/v1/groups/*', requireAuth, requireCsrf);
app.use('/api/v1/groups', requireAuth, requireCsrf);
app.route('/api/v1/groups', groupRoutes);
app.use('/api/v1/dashboard', requireAuth, requireCsrf);
app.route('/api/v1/dashboard', dashboardRoutes);
app.use('/api/v1/*', requireAuth, requireCsrf);
app.route('/api/v1', transferRoutes);
app.notFound((c) => c.json({ error: { code: 'NOT_FOUND', message: 'Endpoint não encontrado.' } }, 404));
app.onError((error, c) => {
  if (error instanceof ApiError) return c.json({ error: { code: error.code, message: error.message, fields: error.fields }, requestId: c.get('requestId') }, error.status);
  console.error(JSON.stringify({ level: 'error', requestId: c.get('requestId'), message: error instanceof Error ? error.message : 'Unknown error' }));
  return c.json({ error: { code: 'INTERNAL_ERROR', message: 'Ocorreu um erro inesperado.' }, requestId: c.get('requestId') }, 500);
});

export default app;
