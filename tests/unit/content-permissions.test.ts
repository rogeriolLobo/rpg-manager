import { describe, expect, it } from 'vitest';
import { canArchiveEntity, canDeleteEntity, canEditEntity, canRestoreEntity, canViewEntity, canViewWorld, resolveEntityVisibility, type EntityAccessContext } from '../../src/domain/content/permissions';
import { createWorldSlug, validateAdventureDetails, validateLocationParent } from '../../src/domain/content/validation';

const base: EntityAccessContext = {
  authenticatedUserId: 'viewer', ownerUserId: 'owner', visibility: 'PRIVATE', archivedAt: null,
  isGroupMember: false, isCampaignMember: false, isActiveCampaignPlayer: false, isCampaignGameMaster: false,
};

describe('permissões centralizadas do Vault', () => {
  it('mantém o owner com leitura e operações exclusivas', () => {
    const owner = {...base, authenticatedUserId: 'owner'};
    expect(resolveEntityVisibility(owner)).toBe('OWNER');
    expect(canViewEntity(owner)).toBe(true);
    expect(canEditEntity(owner)).toBe(true);
    expect(canArchiveEntity(owner)).toBe(true);
    expect(canRestoreEntity(owner)).toBe(false);
    expect(canDeleteEntity(owner)).toBe(true);
  });

  it('aplica PRIVATE e GROUP sem tratar convidado textual como identidade', () => {
    expect(canViewEntity(base)).toBe(false);
    expect(resolveEntityVisibility({...base, visibility:'GROUP', isGroupMember:true})).toBe('GROUP_MEMBER');
    expect(canViewEntity({...base, visibility:'GROUP', isGroupMember:false})).toBe(false);
  });

  it('diferencia CAMPAIGN, PLAYERS e GM_ONLY', () => {
    expect(resolveEntityVisibility({...base, visibility:'CAMPAIGN', isCampaignMember:true})).toBe('CAMPAIGN_MEMBER');
    expect(resolveEntityVisibility({...base, visibility:'PLAYERS', isActiveCampaignPlayer:true})).toBe('PLAYER');
    expect(resolveEntityVisibility({...base, visibility:'PLAYERS', isCampaignGameMaster:true})).toBe('GAME_MASTER');
    expect(canViewEntity({...base, visibility:'PLAYERS', isCampaignMember:true})).toBe(false);
    expect(resolveEntityVisibility({...base, visibility:'GM_ONLY', isCampaignGameMaster:true})).toBe('GAME_MASTER');
    expect(canViewEntity({...base, visibility:'GM_ONLY', isActiveCampaignPlayer:true})).toBe(false);
  });

  it('restringe conteúdo arquivado ao owner até restauração', () => {
    const archived = {...base, visibility:'CAMPAIGN' as const, archivedAt:'2026-08-13T00:00:00.000Z', isCampaignMember:true};
    expect(canViewEntity(archived)).toBe(false);
    const owner = {...archived, authenticatedUserId:'owner'};
    expect(canViewEntity(owner)).toBe(true);
    expect(canEditEntity(owner)).toBe(false);
    expect(canArchiveEntity(owner)).toBe(false);
    expect(canRestoreEntity(owner)).toBe(true);
  });

  it('permite World GROUP somente ao membro e mantém arquivado privado ao owner', () => {
    const world = {authenticatedUserId:'viewer',ownerUserId:'owner',visibility:'GROUP' as const,archivedAt:null,isWorldMember:true};
    expect(canViewWorld(world)).toBe(true);
    expect(canViewWorld({...world,visibility:'PRIVATE'})).toBe(false);
    expect(canViewWorld({...world,archivedAt:'2026-08-13T00:00:00.000Z'})).toBe(false);
    expect(canViewWorld({...world,authenticatedUserId:'owner',archivedAt:'2026-08-13T00:00:00.000Z'})).toBe(true);
  });
});

describe('validações do domínio de conteúdo', () => {
  it('exige detalhes controlados somente para Adventure', () => {
    expect(validateAdventureDetails('ADVENTURE',{adventureType:'ONE_SHOT',recommendedSessions:1,notes:''})).toBe(true);
    expect(validateAdventureDetails('ADVENTURE',null)).toBe(false);
    expect(validateAdventureDetails('ADVENTURE',{adventureType:'CUSTOM',recommendedSessions:0,notes:''})).toBe(false);
    expect(validateAdventureDetails('NPC',null)).toBe(true);
    expect(validateAdventureDetails('NPC',{adventureType:'MODULE',recommendedSessions:null,notes:''})).toBe(false);
  });

  it('restringe parent a Locations e impede ciclos', () => {
    expect(validateLocationParent({entityId:'child',entityType:'LOCATION',parentId:'parent',parentType:'LOCATION',parentAncestorIds:['root']})).toBe(true);
    expect(validateLocationParent({entityId:'child',entityType:'NPC',parentId:'parent',parentType:'LOCATION',parentAncestorIds:[]})).toBe(false);
    expect(validateLocationParent({entityId:'child',entityType:'LOCATION',parentId:'parent',parentType:'NPC',parentAncestorIds:[]})).toBe(false);
    expect(validateLocationParent({entityId:'child',entityType:'LOCATION',parentId:'child',parentType:'LOCATION',parentAncestorIds:[]})).toBe(false);
    expect(validateLocationParent({entityId:'child',entityType:'LOCATION',parentId:'parent',parentType:'LOCATION',parentAncestorIds:['child']})).toBe(false);
  });

  it('gera slug estável sem depender do cliente', () => {
    expect(createWorldSlug('Mundo das Trevas — São Paulo')).toBe('mundo-das-trevas-sao-paulo');
    expect(createWorldSlug('!!!')).toBe('mundo');
  });
});
