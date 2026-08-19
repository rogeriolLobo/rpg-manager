// F-020 (BATCH9): Character Sheet Engine base — motor de fichas genérico e neutro em
// relação a sistema de jogo. Graduado de src/domain/future/character-sheet.ts (o contrato
// puro validateSheet/SheetTemplate já existia e é preservado sem alteração de assinatura —
// ver tests/unit/future-architecture.test.ts).
export const SHEET_FIELD_TYPES = ['TEXT','NUMBER','BOOLEAN','CHOICE'] as const;
export type SheetFieldType = typeof SHEET_FIELD_TYPES[number];
export type SheetValue = string | number | boolean;

export interface SheetFieldDefinition {
  key: string;
  label: string;
  type: SheetFieldType;
  required: boolean;
  options?: string[];
}

export interface SheetTemplate {
  id: string;
  name: string;
  version: number;
  fields: SheetFieldDefinition[];
}

export interface SheetValidationResult { valid:boolean;errors:Record<string,string> }

export function validateSheet(template:SheetTemplate,values:Record<string,SheetValue>):SheetValidationResult {
  const errors:Record<string,string>={},definitions=new Map(template.fields.map((field)=>[field.key,field]));
  if(new Set(template.fields.map((field)=>field.key)).size!==template.fields.length)errors._template='O modelo possui chaves duplicadas.';
  for(const key of Object.keys(values))if(!definitions.has(key))errors[key]='Campo não declarado no modelo.';
  for(const field of template.fields){const value=values[field.key];if(value===undefined||value===''){if(field.required)errors[field.key]='Campo obrigatório.';continue;}if(field.type==='NUMBER'&&typeof value!=='number')errors[field.key]='Informe um número.';else if(field.type==='BOOLEAN'&&typeof value!=='boolean')errors[field.key]='Informe sim ou não.';else if((field.type==='TEXT'||field.type==='CHOICE')&&typeof value!=='string')errors[field.key]='Informe um texto.';else if(field.type==='CHOICE'&&!field.options?.includes(String(value)))errors[field.key]='Opção inválida.';}
  return{valid:Object.keys(errors).length===0,errors};
}

// F-021 (BATCH11): Fichas em PDF — mapeamento de um campo do modelo para uma posição no
// PDF externo do usuário (nunca hospedado/redistribuído por nós — ver
// migrations/0031_sheet_pdf_mapping.sql). ACROFORM referencia um campo de formulário
// preenchível já existente no PDF (detectado no navegador via pdf-lib); OVERLAY desenha o
// valor como texto numa posição (página/x/y) — para PDFs digitalizados/sem AcroForm.
export type PdfFieldMapping =
  | { mode:'ACROFORM'; fieldName:string }
  | { mode:'OVERLAY'; page:number; x:number; y:number; fontSize?:number };

// Só pode mapear campos que realmente existem no modelo — mesma disciplina de
// validateSheet (chaves desconhecidas nunca são silenciosamente aceitas).
export function validatePdfMapping(fields:SheetFieldDefinition[],mapping:Record<string,PdfFieldMapping>):boolean {
  const keys=new Set(fields.map((field)=>field.key));
  return Object.keys(mapping).every((key)=>keys.has(key));
}
