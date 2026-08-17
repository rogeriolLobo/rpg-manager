// LIB-005: leitura de capas enviadas por upload (Zero Cost — Workers KV Free).
// Ver docs/library/COVER_STORAGE.md. O upload em si (POST) e a remoção
// (DELETE) vivem em rpgs.ts, junto do resto da autorização/trava de metadata
// compartilhada de um RPG — aqui só a leitura pública-para-usuários-
// autenticados, servida como <img src="/api/v1/media/covers/:id">.
import { Hono } from 'hono';
import { coverAssetKvKey, isValidCoverAssetId } from '../../domain/rpg/cover-asset';
import { ApiError } from '../http';
import type { AppVariables, Env } from '../types';

export const mediaRoutes = new Hono<{ Bindings: Env; Variables: AppVariables }>();

// Autenticado (requireAuth aplicado em index.ts, mesmo padrão dos demais
// grupos de rotas). GET é método seguro — isento de CSRF (ver
// src/server/security/csrf.ts) — por isso funciona normalmente num <img src>,
// que não anexa o header X-CSRF-Token. O ID é um UUID aleatório gerado só pelo
// servidor (crypto.randomUUID() no upload); não existe listagem por conta, e
// um ID mal-formado ou de um asset já removido cai direto em 404, sem
// distinguir "não existe" de "não autorizado" (mesmo princípio do resto do
// app — nunca vazar existência via mensagem de erro diferente).
mediaRoutes.get('/covers/:id', async (c) => {
  const id = c.req.param('id');
  if (!isValidCoverAssetId(id)) throw new ApiError(404, 'NOT_FOUND', 'Capa não encontrada.');
  const object = await c.env.COVERS_KV.getWithMetadata<{ contentType?: string }>(coverAssetKvKey(id), 'arrayBuffer');
  if (!object.value) throw new ApiError(404, 'NOT_FOUND', 'Capa não encontrada.');
  return new Response(object.value, {
    headers: {
      'Content-Type': object.metadata?.contentType ?? 'application/octet-stream',
      // private: resposta autenticada, não deve ser guardada por caches compartilhados.
      // immutable + max-age longo: cada upload gera um novo UUID (nunca reaproveitado
      // para conteúdo diferente — ver rpgs.ts), então o mesmo ID sempre representa os
      // mesmos bytes.
      'Cache-Control': 'private, max-age=31536000, immutable',
      'X-Content-Type-Options': 'nosniff',
    },
  });
});
