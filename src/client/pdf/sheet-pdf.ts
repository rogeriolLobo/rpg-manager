import type { PdfFieldMapping, SheetFieldDefinition, SheetValue } from '../../domain/sheets';

// F-021 (BATCH11): Fichas em PDF — todo o processamento acontece aqui, no navegador do
// usuário. O RPG Manager nunca busca, armazena ou redistribui o conteúdo do PDF: o
// servidor só guarda pdfUrl (referência) e pdfMapping (metadata de posição/nome de campo).
// Cada exportação busca o PDF de novo, direto do navegador para a URL externa informada
// pelo usuário — a mesma responsabilidade de licenciamento já vale para coverUrl/External
// Resources em outros pontos do produto (o usuário só deve linkar o que tem direito de usar).
//
// `pdf-lib` é importado dinamicamente (nunca no topo do arquivo): é uma dependência
// relativamente pesada usada só por quem realmente abre `/app/sheets` ou uma ficha com PDF
// vinculado — um import estático dobrava o bundle principal (carregado em toda navegação).

async function loadPdf(pdfUrl: string) {
  const { PDFDocument } = await import('pdf-lib');
  const response = await fetch(pdfUrl);
  if (!response.ok) throw new Error(`Não foi possível baixar o PDF (HTTP ${response.status}).`);
  const bytes = await response.arrayBuffer();
  return PDFDocument.load(bytes, { ignoreEncryption: true });
}

// Usado pelo editor de modelo para sugerir nomes de campo AcroForm existentes no PDF,
// em vez de exigir que o usuário descubra/digite o nome interno do campo de cabeça.
export async function detectAcroFormFields(pdfUrl: string): Promise<string[]> {
  const doc = await loadPdf(pdfUrl);
  return doc.getForm().getFields().map((field) => field.getName());
}

export interface FillSheetPdfResult { bytes: Uint8Array; warnings: string[] }

export async function fillSheetPdf(
  pdfUrl: string,
  fields: SheetFieldDefinition[],
  mapping: Record<string, PdfFieldMapping>,
  values: Record<string, SheetValue>,
): Promise<FillSheetPdfResult> {
  const { PDFCheckBox, PDFDropdown, PDFRadioGroup, PDFTextField, StandardFonts } = await import('pdf-lib');
  const doc = await loadPdf(pdfUrl);
  const warnings: string[] = [];
  const pageCount = doc.getPageCount();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const form = doc.getForm();

  for (const field of fields) {
    const entry = mapping[field.key];
    if (!entry) continue;
    const value = values[field.key];
    const text = value === undefined || value === null ? '' : field.type === 'BOOLEAN' ? '' : String(value);
    try {
      if (entry.mode === 'ACROFORM') {
        const pdfField = form.getField(entry.fieldName);
        if (pdfField instanceof PDFCheckBox) { if (value) pdfField.check(); else pdfField.uncheck(); }
        else if (pdfField instanceof PDFDropdown || pdfField instanceof PDFRadioGroup) { if (text) pdfField.select(text); }
        else if (pdfField instanceof PDFTextField) pdfField.setText(text);
        else warnings.push(`Campo "${entry.fieldName}" do PDF tem um tipo não suportado.`);
      } else {
        if (entry.page < 1 || entry.page > pageCount) { warnings.push(`"${field.label}": página ${entry.page} não existe neste PDF (${pageCount} páginas).`); continue; }
        const page = doc.getPage(entry.page - 1);
        const label = field.type === 'BOOLEAN' ? (value ? 'Sim' : 'Não') : text;
        page.drawText(label, { x: entry.x, y: entry.y, size: entry.fontSize ?? 10, font });
      }
    } catch (cause) {
      warnings.push(`Não foi possível preencher "${field.label}": ${cause instanceof Error ? cause.message : 'erro desconhecido'}.`);
    }
  }

  return { bytes: await doc.save(), warnings };
}

export function triggerPdfDownload(bytes: Uint8Array, filename: string): void {
  const blob = new Blob([bytes as BlobPart], { type: 'application/pdf' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url; link.download = filename;
  document.body.appendChild(link); link.click(); link.remove();
  URL.revokeObjectURL(url);
}
