export function normalizeEditorialLabel(value: string): string {
  return value.trim().normalize('NFKD').replace(/[\u0300-\u036f]/gu, '').toLocaleLowerCase('pt-BR').replace(/\s+/gu, ' ');
}

export function extractWikiMentions(content: string): string[] {
  const mentions = new Set<string>();
  for (const match of content.matchAll(/\[\[(.{1,160}?)\]\]/gu)) {
    const normalized = normalizeEditorialLabel(match[1]);
    if (normalized) mentions.add(normalized);
  }
  return [...mentions];
}
