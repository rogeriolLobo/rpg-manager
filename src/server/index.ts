import { Hono } from 'hono';
import { changePassword, deleteAccount, listSessions, login, logout, logoutAll, recover, register, requireAuth, revokeSession, session } from './auth/auth';
import { ApiError } from './http';
import { requireCsrf, requireTrustedOrigin } from './security/csrf';
import { applySecurityHeaders } from './security/headers';
import { campaignRoutes } from './routes/campaigns';
import { dashboardRoutes } from './routes/dashboard';
import { rpgRoutes } from './routes/rpgs';
import { transferRoutes } from './routes/transfer';
import { backupRestoreRoutes } from './routes/backup-restore';
import { groupRoutes } from './routes/groups';
import { directoryRoutes } from './routes/directory';
import { worldRoutes } from './routes/worlds';
import { vaultRoutes } from './routes/vault';
import { preferenceRoutes } from './routes/preferences';
import { knowledgeRoutes } from './routes/knowledge';
import { journalRoutes } from './routes/journal';
import { worldInviteRoutes } from './routes/world-invites';
import { searchRoutes } from './routes/search';
import { relationRoutes } from './routes/relations';
import { timelineRoutes } from './routes/timeline';
import { bestiaryRoutes } from './routes/bestiary';
import { cartographyRoutes } from './routes/cartography';
import { externalResourceRoutes } from './routes/external-resources';
import { mediaRoutes } from './routes/media';
import { socialRoutes } from './routes/social';
import { sheetRoutes } from './routes/sheets';
import { adventureRoutes } from './routes/adventures';
import { fileRoutes } from './routes/files';
import type { AppVariables, Env } from './types';
import { profileSchema } from '../shared/validation/schemas';
import { readJson } from './http';
import { BUILD_COMMIT, BUILD_TIME } from './build-info';

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
// Metadados não sensíveis para confirmar em runtime que a produção está de fato
// executando o commit esperado — sem isso, um deploy "esquecido" (código pronto
// mas nunca publicado) fica invisível até alguém notar visualmente na UI.
app.get('/api/v1/version', (c) => c.json({ commit: BUILD_COMMIT, build: BUILD_TIME, environment: c.env.ENVIRONMENT }));
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
  const now = new Date().toISOString();
  await c.env.DB.batch([
    c.env.DB.prepare('UPDATE users SET display_name=?,updated_at=? WHERE id=?').bind(input.displayName, now, user.id),
    c.env.DB.prepare('UPDATE play_group_members SET player_name=?,updated_at=? WHERE user_id=?').bind(input.displayName, now, user.id),
    c.env.DB.prepare('UPDATE campaign_members SET player_name=?,updated_at=? WHERE user_id=?').bind(input.displayName, now, user.id),
  ]);
  return c.json({ user: { ...user, displayName: input.displayName } });
});
app.use('/api/v1/preferences', requireAuth, requireCsrf);
app.use('/api/v1/preferences/*', requireAuth, requireCsrf);
app.route('/api/v1/preferences', preferenceRoutes);
app.use('/api/v1/rpgs/*', requireAuth, requireCsrf);
app.use('/api/v1/rpgs', requireAuth, requireCsrf);
app.route('/api/v1/rpgs', rpgRoutes);
app.use('/api/v1/campaigns/*', requireAuth, requireCsrf);
app.use('/api/v1/campaigns', requireAuth, requireCsrf);
app.route('/api/v1/campaigns', campaignRoutes);
app.use('/api/v1/groups/*', requireAuth, requireCsrf);
app.use('/api/v1/groups', requireAuth, requireCsrf);
app.route('/api/v1/groups', groupRoutes);
app.use('/api/v1/directory/*', requireAuth, requireCsrf);
app.route('/api/v1/directory', directoryRoutes);
app.use('/api/v1/worlds/*',requireAuth,requireCsrf);
app.use('/api/v1/worlds',requireAuth,requireCsrf);
app.route('/api/v1/worlds',worldRoutes);
app.use('/api/v1/vault/*',requireAuth,requireCsrf);
app.use('/api/v1/vault',requireAuth,requireCsrf);
app.route('/api/v1/vault',vaultRoutes);
app.use('/api/v1/knowledge/*',requireAuth,requireCsrf);
app.route('/api/v1/knowledge',knowledgeRoutes);
app.use('/api/v1/journal/*',requireAuth,requireCsrf);
app.route('/api/v1/journal',journalRoutes);
app.use('/api/v1/world-invites/*',requireAuth,requireCsrf);
app.route('/api/v1/world-invites',worldInviteRoutes);
app.use('/api/v1/search',requireAuth,requireCsrf);
app.route('/api/v1/search',searchRoutes);
app.use('/api/v1/relations/*',requireAuth,requireCsrf);
app.route('/api/v1/relations',relationRoutes);
app.use('/api/v1/timeline/*',requireAuth,requireCsrf);
app.route('/api/v1/timeline',timelineRoutes);
app.use('/api/v1/bestiary/*',requireAuth,requireCsrf);
app.route('/api/v1/bestiary',bestiaryRoutes);
app.use('/api/v1/external-resources/*',requireAuth,requireCsrf);
app.route('/api/v1/external-resources',externalResourceRoutes);
app.use('/api/v1/cartography/*',requireAuth,requireCsrf);
app.route('/api/v1/cartography',cartographyRoutes);
app.use('/api/v1/dashboard', requireAuth, requireCsrf);
app.route('/api/v1/dashboard', dashboardRoutes);
app.use('/api/v1/media/*', requireAuth, requireCsrf);
app.route('/api/v1/media', mediaRoutes);
app.use('/api/v1/social/*', requireAuth, requireCsrf);
app.route('/api/v1/social', socialRoutes);
app.use('/api/v1/sheets/*', requireAuth, requireCsrf);
app.route('/api/v1/sheets', sheetRoutes);
app.use('/api/v1/adventures/*', requireAuth, requireCsrf);
app.route('/api/v1/adventures', adventureRoutes);
app.use('/api/v1/files/*', requireAuth, requireCsrf);
app.use('/api/v1/files', requireAuth, requireCsrf);
app.route('/api/v1/files', fileRoutes);
app.use('/api/v1/*', requireAuth, requireCsrf);
app.route('/api/v1', transferRoutes);
app.route('/api/v1', backupRestoreRoutes);
app.notFound((c) => c.json({ error: { code: 'NOT_FOUND', message: 'Endpoint não encontrado.' } }, 404));
app.onError((error, c) => {
  if (error instanceof ApiError) return c.json({ error: { code: error.code, message: error.message, fields: error.fields }, requestId: c.get('requestId') }, error.status);
  console.error(JSON.stringify({ level: 'error', requestId: c.get('requestId'), message: error instanceof Error ? error.message : 'Unknown error' }));
  return c.json({ error: { code: 'INTERNAL_ERROR', message: 'Ocorreu um erro inesperado.' }, requestId: c.get('requestId') }, 500);
});

export default app;
