import { DurableObject } from 'cloudflare:workers';
import type { VttRealtimeClientMessage, VttRealtimeRole, VttRealtimeServerMessage, VttRealtimeStateReason } from '../domain/vtt-realtime';
import { buildGmLiveScenePayload, buildPlayerLiveScenePayload } from './routes/vtt';
import type { Env } from './types';

// F-031 (correção 2026-08-20): coordenador realtime de uma Campaign — um Durable Object por
// Campaign (`env.VTT_ROOMS.idFromName(campaignId)`), SQLite-backed (Workers Free, ver
// docs/architecture/VTT_REALTIME_ZERO_COST_AUDIT.md). NUNCA guarda estado de domínio: scenes,
// tokens, fog e combatants continuam só em D1, via as rotas REST já existentes em
// src/server/routes/vtt.ts. Este objeto só coordena: conexões WebSocket abertas (com
// role/userId resolvidos no handshake pela rota HTTP, nunca por este objeto) e um contador de
// sequência (`ctx.storage`, sobrevive a hibernação). Evita duas fontes de verdade.
//
// Usa a Hibernatable WebSockets API (`ctx.acceptWebSocket`/`getWebSockets`/`getTags`) — as tags
// carregam role/userId/campaignId por conexão, então nada precisa ficar em memória de instância
// (que hibernação descarta); tudo é recuperado das tags quando a mensagem chega.
export class VttRoomDO extends DurableObject<Env> {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === '/broadcast') {
      if (request.method !== 'POST') return new Response(null, { status: 405 });
      const body = await request.json<{ reason: VttRealtimeStateReason }>().catch(() => null);
      if (body?.reason) await this.broadcast(body.reason);
      return new Response(null, { status: 204 });
    }
    if (request.headers.get('Upgrade') !== 'websocket') return new Response('Expected websocket', { status: 426 });
    const role = request.headers.get('X-Vtt-Role');
    const userId = request.headers.get('X-Vtt-User-Id');
    // .../vtt/:campaignId/realtime — a requisição chega com a URL ORIGINAL (nunca reconstruída,
    // ver comentário em src/server/routes/vtt.ts), então o campaignId vem do próprio path.
    const campaignId = url.pathname.match(/\/vtt\/([^/]+)\/realtime$/u)?.[1];
    // Defesa em profundidade: a rota HTTP (vttRoutes) já validou sessão+membership antes de
    // encaminhar aqui — isto só garante que o próprio Durable Object nunca aceita uma conexão
    // sem os três metadados que o resto da classe assume que sempre existem.
    if ((role !== 'GM' && role !== 'PLAYER') || !userId || !campaignId) return new Response('Missing connection metadata', { status: 400 });
    // BATCH23 (Seção 20 do pedido de finalização — "max connections por room"): generoso o
    // bastante para os cenários reais medidos (2 GMs + 8 Players = 10, mais reconexões/abas
    // extras), mas impede uma sala de crescer sem limite (ex.: um bug de reconexão em loop no
    // client acumulando conexões — mesmo tipo de incidente já corrigido nos testes E2E deste
    // projeto, ver docs/architecture/VTT_LOAD_TEST.md).
    if (this.ctx.getWebSockets().length >= 20) return new Response('Sala cheia — limite de conexões simultâneas atingido.', { status: 429 });
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    this.ctx.acceptWebSocket(server, [`role:${role}`, `user:${userId}`, `campaign:${campaignId}`]);
    const sequence = await this.currentSequence();
    server.send(JSON.stringify({ type: 'HELLO', sequence, role } satisfies VttRealtimeServerMessage));
    const payload = await this.payloadFor(role, campaignId);
    server.send(JSON.stringify({ type: 'STATE', sequence, reason: 'SNAPSHOT', role, payload } as VttRealtimeServerMessage));
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, message: ArrayBuffer | string): Promise<void> {
    if (typeof message !== 'string') return;
    let parsed: VttRealtimeClientMessage;
    try { parsed = JSON.parse(message); } catch { return; }
    const role = tagValue(this.ctx.getTags(ws), 'role') as VttRealtimeRole | undefined;
    const campaignId = tagValue(this.ctx.getTags(ws), 'campaign');
    if (!role || !campaignId) return;
    if (parsed.type === 'PING') { ws.send(JSON.stringify({ type: 'PONG' } satisfies VttRealtimeServerMessage)); return; }
    if (parsed.type === 'RESYNC') {
      const sequence = await this.currentSequence();
      const payload = await this.payloadFor(role, campaignId);
      ws.send(JSON.stringify({ type: 'STATE', sequence, reason: 'SNAPSHOT', role, payload } as VttRealtimeServerMessage));
    }
  }

  // Hibernation cuida do cleanup de sockets fechados/quebrados — não há nada em memória de
  // instância para desalocar aqui (ver comentário no topo da classe).
  async webSocketClose(): Promise<void> { /* no-op — ver comentário acima */ }
  async webSocketError(): Promise<void> { /* no-op — ver comentário acima */ }

  private async currentSequence(): Promise<number> {
    return (await this.ctx.storage.get<number>('sequence')) ?? 0;
  }

  private async payloadFor(role: VttRealtimeRole, campaignId: string) {
    return role === 'GM' ? buildGmLiveScenePayload(this.env.DB, campaignId) : buildPlayerLiveScenePayload(this.env.DB, campaignId);
  }

  // Chamado só pela própria rota interna /broadcast (nunca por um client diretamente) depois de
  // uma escrita em D1 já commitada por uma rota REST de vttRoutes. Sempre re-lê o estado atual
  // do D1 e retransmite o snapshot COMPLETO (nunca um diff parcial — ver justificativa em
  // docs/architecture/VTT_REALTIME_ZERO_COST_AUDIT.md), filtrado por papel de cada conexão.
  private async broadcast(reason: VttRealtimeStateReason): Promise<void> {
    const sockets = this.ctx.getWebSockets();
    if (!sockets.length) return;
    const campaignId = tagValue(this.ctx.getTags(sockets[0]), 'campaign');
    if (!campaignId) return;
    const sequence = ((await this.ctx.storage.get<number>('sequence')) ?? 0) + 1;
    await this.ctx.storage.put('sequence', sequence);
    const [gmPayload, playerPayload] = await Promise.all([
      buildGmLiveScenePayload(this.env.DB, campaignId),
      buildPlayerLiveScenePayload(this.env.DB, campaignId),
    ]);
    for (const ws of sockets) {
      const role = tagValue(this.ctx.getTags(ws), 'role') as VttRealtimeRole | undefined;
      if (!role) continue;
      const message: VttRealtimeServerMessage = role === 'GM'
        ? { type: 'STATE', sequence, reason, role: 'GM', payload: gmPayload }
        : { type: 'STATE', sequence, reason, role: 'PLAYER', payload: playerPayload };
      try { ws.send(JSON.stringify(message)); } catch { /* socket morto — hibernation cuida do cleanup */ }
    }
  }
}

function tagValue(tags: string[], prefix: string): string | undefined {
  const tag = tags.find((t) => t.startsWith(`${prefix}:`));
  return tag ? tag.slice(prefix.length + 1) : undefined;
}
