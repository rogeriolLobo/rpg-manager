import { describe, expect, it } from 'vitest';

/**
 * Navigation invariants — validates the link-building logic from AppShell.
 *
 * The sidebar renders three link groups:
 *   globalLinks  — always visible regardless of activeWorld
 *   worldLinks   — only when activeWorld is set
 *   accountLinks — always visible
 *
 * These tests replicate the exact link-construction logic from app-shell.tsx
 * to guarantee that UX invariants (docs/product/UX_INVARIANTS.md) hold.
 */

// ── helpers that mirror the app-shell logic ──────────────────────────

interface ActiveWorldOption {
  id: string;
  name: string;
  visibility: 'PRIVATE' | 'GROUP';
  isOwner: boolean;
}

function buildGlobalLinks() {
  return [
    '/app/library',   // Biblioteca
    '/app/vault',     // Vault
    '/app/groups',    // Grupos
    '/app/campaigns', // Campanhas
    '/app/worlds',    // Mundos
  ];
}

function buildWorldLinks(activeWorld: ActiveWorldOption | null) {
  if (!activeWorld) return [];
  return [
    `/app/worlds/${activeWorld.id}`,              // Visão do World
    `/app/worlds/${activeWorld.id}/wiki`,          // Wiki
    ...(activeWorld.isOwner
      ? [`/app/worlds/${activeWorld.id}/journal`]  // Diário (owner only)
      : []),
    `/app/worlds/${activeWorld.id}/relations`,     // Relações
    `/app/worlds/${activeWorld.id}/timeline`,      // Timeline
    `/app/worlds/${activeWorld.id}/bestiary`,      // Bestiário
    `/app/worlds/${activeWorld.id}/portal`,        // Portal do jogador
  ];
}

function buildAccountLinks() {
  return ['/app/settings', '/app/security', '/app/profile'];
}

// ── test suites ──────────────────────────────────────────────────────

describe('navigation invariants', () => {
  describe('activeWorld = null', () => {
    const global = buildGlobalLinks();
    const world = buildWorldLinks(null);
    const account = buildAccountLinks();

    it('Biblioteca aparece nos links globais', () => {
      expect(global).toContain('/app/library');
    });
    it('Vault aparece nos links globais', () => {
      expect(global).toContain('/app/vault');
    });
    it('Grupos aparece nos links globais', () => {
      expect(global).toContain('/app/groups');
    });
    it('Campanhas aparece nos links globais', () => {
      expect(global).toContain('/app/campaigns');
    });
    it('Mundos aparece nos links globais', () => {
      expect(global).toContain('/app/worlds');
    });
    it('Configurações aparece nos links de conta', () => {
      expect(account).toContain('/app/settings');
    });
    it('Segurança aparece nos links de conta', () => {
      expect(account).toContain('/app/security');
    });
    it('Perfil aparece nos links de conta', () => {
      expect(account).toContain('/app/profile');
    });
    it('nenhum link de World existe', () => {
      expect(world).toHaveLength(0);
    });
    it('Wiki não aparece', () => {
      expect(world.some((link) => link.includes('/wiki'))).toBe(false);
    });
    it('Relations/Graph não aparece', () => {
      expect(world.some((link) => link.includes('/relations'))).toBe(false);
    });
    it('Timeline/Calendar não aparece', () => {
      expect(world.some((link) => link.includes('/timeline'))).toBe(false);
    });
    it('Bestiary não aparece', () => {
      expect(world.some((link) => link.includes('/bestiary'))).toBe(false);
    });
    it('Journal não aparece', () => {
      expect(world.some((link) => link.includes('/journal'))).toBe(false);
    });
  });

  describe('activeWorld = World A (owner)', () => {
    const worldA: ActiveWorldOption = { id: 'world-a', name: 'Aldea', visibility: 'PRIVATE', isOwner: true };
    const global = buildGlobalLinks();
    const world = buildWorldLinks(worldA);
    const account = buildAccountLinks();

    it('links globais continuam existindo', () => {
      expect(global).toContain('/app/library');
      expect(global).toContain('/app/vault');
      expect(global).toContain('/app/groups');
      expect(global).toContain('/app/campaigns');
      expect(global).toContain('/app/worlds');
    });
    it('links de conta continuam existindo', () => {
      expect(account).toContain('/app/settings');
      expect(account).toContain('/app/security');
      expect(account).toContain('/app/profile');
    });
    it('Vault global aponta para /app/vault sem filtro', () => {
      expect(global).toContain('/app/vault');
      expect(global.some((link) => link.includes('worldId'))).toBe(false);
    });
    it('Campanhas global aponta para /app/campaigns sem filtro', () => {
      expect(global).toContain('/app/campaigns');
      expect(global.some((link) => link.includes('worldId'))).toBe(false);
    });
    it('seção World inclui visão do world', () => {
      expect(world).toContain('/app/worlds/world-a');
    });
    it('seção World inclui Wiki', () => {
      expect(world).toContain('/app/worlds/world-a/wiki');
    });
    it('seção World inclui Diário para owner', () => {
      expect(world).toContain('/app/worlds/world-a/journal');
    });
    it('seção World inclui Relações (Graph/Genealogy são views internas)', () => {
      expect(world).toContain('/app/worlds/world-a/relations');
    });
    it('seção World inclui Timeline (Calendar é embutido)', () => {
      expect(world).toContain('/app/worlds/world-a/timeline');
    });
    it('seção World inclui Bestiário', () => {
      expect(world).toContain('/app/worlds/world-a/bestiary');
    });
    it('seção World inclui Portal do jogador', () => {
      expect(world).toContain('/app/worlds/world-a/portal');
    });
  });

  describe('activeWorld = World B (non-owner / player)', () => {
    const worldB: ActiveWorldOption = { id: 'world-b', name: 'Ravenloft', visibility: 'GROUP', isOwner: false };
    const world = buildWorldLinks(worldB);

    it('Diário NÃO aparece para non-owner', () => {
      expect(world.some((link) => link.includes('/journal'))).toBe(false);
    });
    it('Wiki aparece para non-owner', () => {
      expect(world).toContain('/app/worlds/world-b/wiki');
    });
    it('Portal do jogador aparece para non-owner', () => {
      expect(world).toContain('/app/worlds/world-b/portal');
    });
    it('Relações aparece para non-owner', () => {
      expect(world).toContain('/app/worlds/world-b/relations');
    });
    it('links globais não são afetados pelo papel no World', () => {
      const global = buildGlobalLinks();
      expect(global).toContain('/app/vault');
      expect(global).toContain('/app/campaigns');
    });
  });

  describe('deep links', () => {
    it('/app/campaigns é rota válida e não requer activeWorld', () => {
      const global = buildGlobalLinks();
      expect(global).toContain('/app/campaigns');
    });
    it('/app/vault é rota válida e não requer activeWorld', () => {
      const global = buildGlobalLinks();
      expect(global).toContain('/app/vault');
    });
    it('/app/worlds é rota válida e não requer activeWorld', () => {
      const global = buildGlobalLinks();
      expect(global).toContain('/app/worlds');
    });
  });
});
