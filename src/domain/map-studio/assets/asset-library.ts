export const ASSET_GENRES = [
  'GENERIC', 'FANTASY', 'MODERN', 'SCI_FI', 'CYBERPUNK', 'HORROR',
  'HISTORICAL', 'WESTERN', 'POST_APOCALYPTIC', 'SPACE', 'ABSTRACT', 'CUSTOM',
] as const;

export const ASSET_CATEGORIES = ['NATURE', 'STRUCTURES', 'PROPS', 'ABSTRACT', 'SPACE'] as const;

export type AssetGenre = typeof ASSET_GENRES[number];
export type AssetCategory = typeof ASSET_CATEGORIES[number];

export interface AssetVectorPath {
  d: string;
  fill: string;
  stroke?: string;
  strokeWidth?: number;
}

export interface AssetDefinition {
  id: string;
  packId: string;
  name: string;
  category: AssetCategory;
  genre: AssetGenre;
  tags: readonly string[];
  defaultWidth: number;
  defaultHeight: number;
  viewBox: readonly [number, number, number, number];
  paths: readonly AssetVectorPath[];
}

export interface AssetPack {
  id: string;
  name: string;
  description: string;
  genres: readonly AssetGenre[];
  assetIds: readonly string[];
  source: 'BUILT_IN';
}

export interface AssetSearchQuery {
  text?: string;
  category?: AssetCategory | 'ALL';
  packId?: string | 'ALL';
  tag?: string;
}

const VIEW_BOX = [0, 0, 64, 64] as const;

function definition(
  id: string,
  name: string,
  category: AssetCategory,
  tags: readonly string[],
  defaultWidth: number,
  defaultHeight: number,
  paths: readonly AssetVectorPath[],
  genre: AssetGenre = 'GENERIC',
): AssetDefinition {
  return Object.freeze({
    id: `builtin:core/${id}`,
    packId: 'builtin:core',
    name,
    category,
    genre,
    tags: Object.freeze([...tags]),
    defaultWidth,
    defaultHeight,
    viewBox: VIEW_BOX,
    paths: Object.freeze(paths.map((path) => Object.freeze({ ...path }))),
  });
}

const BUILTIN_ASSETS = Object.freeze([
  definition('nature/tree-broadleaf', 'Árvore frondosa', 'NATURE', ['tree', 'árvore', 'forest', 'floresta'], 96, 112, [
    { d: 'M27 55h10l-2-19h-6z', fill: '#76513a' },
    { d: 'M32 5c-8 0-13 6-13 13-7 1-11 6-11 12 0 8 7 13 15 12 3 7 15 9 21 3 9 2 14-5 12-13 5-7 0-16-8-17C46 9 40 5 32 5z', fill: '#4f7f45', stroke: '#284e31', strokeWidth: 2 },
  ]),
  definition('nature/tree-pine', 'Pinheiro', 'NATURE', ['tree', 'pine', 'árvore', 'conifer', 'forest'], 82, 128, [
    { d: 'M28 47h8l2 12H26z', fill: '#6f4a32' },
    { d: 'M32 4 14 29h9L10 45h44L41 29h9z', fill: '#376b4b', stroke: '#214632', strokeWidth: 2 },
  ]),
  definition('nature/bush', 'Arbusto', 'NATURE', ['bush', 'arbusto', 'shrub', 'forest'], 78, 58, [
    { d: 'M8 48c-5-10 2-20 12-19-1-11 14-16 20-7 10-3 19 7 14 17-10 7-36 8-46 2z', fill: '#5f8d46', stroke: '#34562e', strokeWidth: 2 },
  ]),
  definition('nature/rock', 'Rocha', 'NATURE', ['rock', 'rocha', 'stone', 'pedra'], 70, 54, [
    { d: 'M7 50 16 22 32 10l18 8 8 32z', fill: '#858987', stroke: '#4f5553', strokeWidth: 2 },
    { d: 'm16 22 16 12 18-16-8 25-10-9-17 16z', fill: '#a8aaa7' },
  ]),
  definition('nature/boulder', 'Pedregulho', 'NATURE', ['boulder', 'rock', 'pedra', 'rocha'], 100, 76, [
    { d: 'M5 50 12 24 27 8l22 6 10 22-7 17H15z', fill: '#747a7a', stroke: '#454a4b', strokeWidth: 2 },
    { d: 'm13 24 22 8 14-18 5 28-19-10-20 18z', fill: '#969a98' },
  ]),
  definition('nature/mountain', 'Montanha', 'NATURE', ['mountain', 'montanha', 'peak', 'pico'], 160, 120, [
    { d: 'M3 56 25 13l8 12L42 7l19 49z', fill: '#707a75', stroke: '#3f4945', strokeWidth: 2 },
    { d: 'm17 29 8-16 8 12 9-18 7 18-8-5-6 9-9-6z', fill: '#e8eee9' },
  ]),
  definition('nature/hill', 'Colina', 'NATURE', ['hill', 'colina', 'landscape'], 150, 72, [
    { d: 'M3 55C14 27 25 17 38 28c7 6 13 14 23 27z', fill: '#74965b', stroke: '#47633a', strokeWidth: 2 },
  ]),

  definition('structures/small-house', 'Casa pequena', 'STRUCTURES', ['house', 'casa', 'building', 'village'], 112, 96, [
    { d: 'M11 28h42v29H11z', fill: '#d3b27a', stroke: '#674b34', strokeWidth: 2 },
    { d: 'M6 30 32 8l26 22z', fill: '#8c493d', stroke: '#5d302c', strokeWidth: 2 },
    { d: 'M27 40h10v17H27z', fill: '#65442f' },
  ]),
  definition('structures/tower', 'Torre', 'STRUCTURES', ['tower', 'torre', 'fort', 'castle'], 82, 140, [
    { d: 'M15 16h34v43H15z', fill: '#9a9d95', stroke: '#51564f', strokeWidth: 2 },
    { d: 'M12 6h9v8h8V6h7v8h8V6h8v14H12z', fill: '#7d827b', stroke: '#51564f', strokeWidth: 2 },
    { d: 'M27 42c0-7 10-7 10 0v17H27z', fill: '#4d4a43' },
  ]),
  definition('structures/wall-segment', 'Segmento de muralha', 'STRUCTURES', ['wall', 'muralha', 'fortification'], 150, 54, [
    { d: 'M4 16h56v42H4z', fill: '#8b8e88', stroke: '#4e514d', strokeWidth: 2 },
    { d: 'M4 8h10v10h8V8h10v10h9V8h10v10h9v8H4z', fill: '#a3a59f' },
  ]),
  definition('structures/gate', 'Portão', 'STRUCTURES', ['door', 'gate', 'porta', 'portão'], 76, 104, [
    { d: 'M10 58V25C10 5 54 5 54 25v33H43V28c0-14-22-14-22 0v30z', fill: '#81847f', stroke: '#4a4d49', strokeWidth: 2 },
    { d: 'M21 58V28c0-14 22-14 22 0v30z', fill: '#795237' },
  ]),
  definition('structures/ruin', 'Ruína', 'STRUCTURES', ['ruin', 'ruína', 'broken', 'ancient'], 126, 90, [
    { d: 'M7 56V13h13v11h8V8h12v20h9V18h9v38H45V43H31v13z', fill: '#8d8c7e', stroke: '#505048', strokeWidth: 2 },
    { d: 'm7 13 8 6 5-6v11l8 5V8l6 8 6-8v20l9 7V18l9 7', fill: 'none', stroke: '#b8b5a3', strokeWidth: 2 },
  ]),

  definition('props/crate', 'Caixote', 'PROPS', ['crate', 'caixa', 'cargo'], 58, 58, [
    { d: 'M8 8h48v48H8z', fill: '#9a663d', stroke: '#563820', strokeWidth: 3 },
    { d: 'm10 10 44 44m0-44L10 54', fill: 'none', stroke: '#6d472b', strokeWidth: 4 },
  ]),
  definition('props/barrel', 'Barril', 'PROPS', ['barrel', 'barril', 'cargo'], 48, 66, [
    { d: 'M15 6h34l5 9-3 39-7 6H20l-7-6-3-39z', fill: '#925c34', stroke: '#52351f', strokeWidth: 2 },
    { d: 'M12 17h40M12 47h40', fill: 'none', stroke: '#353a39', strokeWidth: 4 },
  ]),
  definition('props/table', 'Mesa', 'PROPS', ['table', 'mesa', 'furniture'], 90, 62, [
    { d: 'M7 14h50v27H7z', fill: '#9b6a43', stroke: '#553a26', strokeWidth: 2 },
    { d: 'M12 41h7v17h-7zm33 0h7v17h-7z', fill: '#65462e' },
  ]),
  definition('props/campfire', 'Fogueira', 'PROPS', ['campfire', 'fire', 'fogueira', 'acampamento'], 64, 72, [
    { d: 'm10 53 44-20m-44 0 44 20', fill: 'none', stroke: '#68442e', strokeWidth: 7 },
    { d: 'M32 50C8 38 25 24 29 7c16 14 25 32 3 43z', fill: '#e95d2a', stroke: '#89351d', strokeWidth: 2 },
    { d: 'M32 44c-9-8 0-15 1-24 7 8 9 17-1 24z', fill: '#f7bd38' },
  ]),

  definition('abstract/marker', 'Marcador', 'ABSTRACT', ['marker', 'pin', 'marcador'], 56, 72, [
    { d: 'M32 4C15 4 9 22 17 35l15 24 15-24C55 22 49 4 32 4z', fill: '#d95c4f', stroke: '#71312b', strokeWidth: 2 },
    { d: 'M32 14a9 9 0 1 0 0 18 9 9 0 0 0 0-18z', fill: '#f6ead9' },
  ], 'ABSTRACT'),
  definition('abstract/circle-marker', 'Marcador circular', 'ABSTRACT', ['circle', 'marker', 'círculo'], 64, 64, [
    { d: 'M32 5a27 27 0 1 0 0 54 27 27 0 0 0 0-54z', fill: '#4f7cac', stroke: '#243f5c', strokeWidth: 4 },
    { d: 'M32 18a14 14 0 1 0 0 28 14 14 0 0 0 0-28z', fill: '#dce8f2' },
  ], 'ABSTRACT'),
  definition('abstract/arrow', 'Indicador', 'ABSTRACT', ['arrow', 'seta', 'indicator'], 100, 50, [
    { d: 'M4 24h38V10l18 22-18 22V40H4z', fill: '#e0a33d', stroke: '#77541f', strokeWidth: 2 },
  ], 'ABSTRACT'),
  definition('abstract/zone', 'Marcador de zona', 'ABSTRACT', ['zone', 'area', 'zona', 'region'], 110, 110, [
    { d: 'M32 5a27 27 0 1 0 0 54 27 27 0 0 0 0-54z', fill: '#8b5cf6', stroke: '#4c288e', strokeWidth: 3 },
    { d: 'M32 14a18 18 0 1 0 0 36 18 18 0 0 0 0-36z', fill: '#c9b7f5' },
  ], 'ABSTRACT'),

  definition('space/planet', 'Planeta', 'SPACE', ['planet', 'planeta', 'world', 'space'], 128, 128, [
    { d: 'M32 9a23 23 0 1 0 0 46 23 23 0 0 0 0-46z', fill: '#5685a8', stroke: '#263f57', strokeWidth: 2 },
    { d: 'M9 40c10 7 35 8 47-2M15 20c9 5 23 6 34 0', fill: 'none', stroke: '#8fc2bd', strokeWidth: 4 },
    { d: 'M4 43c15 8 43 12 56-2', fill: 'none', stroke: '#d2b26b', strokeWidth: 3 },
  ], 'SPACE'),
  definition('space/asteroid', 'Asteroide', 'SPACE', ['asteroid', 'asteroide', 'rock', 'space'], 78, 70, [
    { d: 'M9 22 23 6l20 5 12 15-4 23-17 10-21-8-6-16z', fill: '#777a80', stroke: '#41444a', strokeWidth: 2 },
    { d: 'M20 24a6 5 0 1 0 0 10 6 5 0 0 0 0-10zm22 14a7 6 0 1 0 0 12 7 6 0 0 0 0-12z', fill: '#565a60' },
  ], 'SPACE'),
  definition('space/station', 'Estação espacial', 'SPACE', ['station', 'estação', 'orbital', 'space'], 132, 96, [
    { d: 'M25 18h14v28H25z', fill: '#8da4b5', stroke: '#364b5a', strokeWidth: 2 },
    { d: 'M4 24h21v16H4zm35 0h21v16H39z', fill: '#4f6f86', stroke: '#2e4656', strokeWidth: 2 },
    { d: 'M32 8a7 7 0 1 0 0 14 7 7 0 0 0 0-14zm0 42a7 7 0 1 0 0 14 7 7 0 0 0 0-14z', fill: '#c8d4db' },
  ], 'SPACE'),
  definition('space/ship-marker', 'Nave', 'SPACE', ['ship', 'nave', 'spaceship', 'marker'], 112, 72, [
    { d: 'M5 32 51 9l8 23-8 23z', fill: '#d4d9dc', stroke: '#3e505c', strokeWidth: 2 },
    { d: 'm20 32 23-9v18z', fill: '#5e8ba3' },
    { d: 'M8 26v12L1 44V20z', fill: '#e67d3e' },
  ], 'SPACE'),
] satisfies readonly AssetDefinition[]);

const BUILTIN_PACK: AssetPack = Object.freeze({
  id: 'builtin:core',
  name: 'Core Symbols',
  description: 'Símbolos vetoriais originais incluídos no RPG Manager.',
  genres: Object.freeze(['GENERIC', 'FANTASY', 'SPACE', 'ABSTRACT'] as AssetGenre[]),
  assetIds: Object.freeze(BUILTIN_ASSETS.map((asset) => asset.id)),
  source: 'BUILT_IN',
});

function normalizeSearch(value: string): string {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/gu, '').toLocaleLowerCase().trim();
}

export class AssetLibrary {
  readonly #assets: readonly AssetDefinition[];
  readonly #packs: readonly AssetPack[];
  readonly #byId: ReadonlyMap<string, AssetDefinition>;
  readonly #searchText: ReadonlyMap<string, string>;

  constructor(assets: readonly AssetDefinition[], packs: readonly AssetPack[]) {
    this.#assets = Object.freeze([...assets]);
    this.#packs = Object.freeze([...packs]);
    this.#byId = new Map(this.#assets.map((asset) => [asset.id, asset]));
    this.#searchText = new Map(this.#assets.map((asset) => [
      asset.id,
      normalizeSearch([asset.name, asset.category, ...asset.tags].join(' ')),
    ]));
  }

  listAssets(): readonly AssetDefinition[] { return this.#assets; }
  listPacks(): readonly AssetPack[] { return this.#packs; }
  get(assetId: string): AssetDefinition | null { return this.#byId.get(assetId) ?? null; }

  search(query: AssetSearchQuery = {}): readonly AssetDefinition[] {
    const text = normalizeSearch(query.text ?? '');
    const tag = normalizeSearch(query.tag ?? '');
    return this.#assets.filter((asset) => {
      if (query.category && query.category !== 'ALL' && asset.category !== query.category) return false;
      if (query.packId && query.packId !== 'ALL' && asset.packId !== query.packId) return false;
      if (tag && !asset.tags.some((candidate) => normalizeSearch(candidate) === tag)) return false;
      return !text || this.#searchText.get(asset.id)?.includes(text);
    });
  }
}

export const assetLibrary = new AssetLibrary(BUILTIN_ASSETS, [BUILTIN_PACK]);

export function assetAspectRatio(asset: AssetDefinition): number {
  return asset.defaultWidth / asset.defaultHeight;
}
