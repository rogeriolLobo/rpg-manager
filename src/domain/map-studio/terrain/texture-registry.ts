import type { TerrainBrush, TerrainTextureId } from './terrain-types';

export type TextureRendererKey = 'fibers' | 'granular' | 'facets' | 'waves' | 'flakes' | 'blocks' | 'grain' | 'crosshatch' | 'plain';

export interface TextureDefinition {
  id: TerrainTextureId;
  name: string;
  category: 'NATURAL' | 'BUILT' | 'GENERIC';
  renderer: TextureRendererKey;
  palette: readonly [string, string, string];
  preview: string;
  defaults: Partial<TerrainBrush>;
}

const definitions: TextureDefinition[] = [
  { id: 'grass', name: 'Grass', category: 'NATURAL', renderer: 'fibers', palette: ['#557a35','#78994b','#314f27'], preview: 'linear-gradient(135deg,#314f27,#78994b 48%,#557a35)', defaults: { color: '#557a35', hardness: .52 } },
  { id: 'dirt', name: 'Dirt', category: 'NATURAL', renderer: 'granular', palette: ['#79543a','#a57952','#4e3529'], preview: 'radial-gradient(circle at 30% 35%,#a57952 0 8%,transparent 9%),#79543a', defaults: { color: '#79543a', hardness: .68 } },
  { id: 'sand', name: 'Sand', category: 'NATURAL', renderer: 'granular', palette: ['#d3b66f','#ead390','#a98c50'], preview: 'radial-gradient(circle at 70% 30%,#ead390 0 7%,transparent 8%),#d3b66f', defaults: { color: '#d3b66f', hardness: .38 } },
  { id: 'rock', name: 'Rock', category: 'NATURAL', renderer: 'facets', palette: ['#686b68','#8a8d86','#454846'], preview: 'linear-gradient(150deg,#454846 0 32%,#8a8d86 33% 58%,#686b68 59%)', defaults: { color: '#686b68', hardness: .78 } },
  { id: 'water', name: 'Water', category: 'NATURAL', renderer: 'waves', palette: ['#276b8d','#4b9fbd','#17485f'], preview: 'repeating-radial-gradient(ellipse at 20% 50%,#4b9fbd 0 2px,#276b8d 3px 8px)', defaults: { color: '#276b8d', hardness: .3, opacity: .76 } },
  { id: 'snow', name: 'Snow', category: 'NATURAL', renderer: 'flakes', palette: ['#e9f1f5','#ffffff','#a9c2d0'], preview: 'radial-gradient(circle at 35% 35%,#fff 0 12%,transparent 13%),#dceaf0', defaults: { color: '#e9f1f5', hardness: .42 } },
  { id: 'stone', name: 'Stone', category: 'BUILT', renderer: 'blocks', palette: ['#777a78','#a1a39f','#4e514f'], preview: 'repeating-linear-gradient(90deg,#777a78 0 14px,#4e514f 15px 17px)', defaults: { color: '#777a78', hardness: .86 } },
  { id: 'wood', name: 'Wood', category: 'BUILT', renderer: 'grain', palette: ['#8d5d35','#b9814f','#5d3924'], preview: 'repeating-linear-gradient(8deg,#8d5d35 0 7px,#b9814f 8px 10px,#5d3924 11px 12px)', defaults: { color: '#8d5d35', hardness: .8 } },
  { id: 'metal', name: 'Metal', category: 'BUILT', renderer: 'crosshatch', palette: ['#69747b','#aeb9bf','#3f484d'], preview: 'repeating-linear-gradient(135deg,#69747b 0 5px,#aeb9bf 6px 8px,#3f484d 9px 11px)', defaults: { color: '#69747b', hardness: .9 } },
  { id: 'plain', name: 'Plain Color', category: 'GENERIC', renderer: 'plain', palette: ['#4f7cac','#4f7cac','#4f7cac'], preview: 'linear-gradient(#4f7cac,#4f7cac)', defaults: { color: '#4f7cac', hardness: .72 } },
];

export class TextureRegistry {
  private readonly byId = new Map(definitions.map((definition) => [definition.id, definition]));

  list(): readonly TextureDefinition[] {
    return definitions;
  }

  get(id: TerrainTextureId): TextureDefinition {
    const definition = this.byId.get(id);
    if (!definition) throw new Error(`Textura Terrain desconhecida: ${id}`);
    return definition;
  }

  applyDefaults(id: TerrainTextureId, brush: TerrainBrush): TerrainBrush {
    return { ...brush, ...this.get(id).defaults };
  }
}

export const textureRegistry = new TextureRegistry();
