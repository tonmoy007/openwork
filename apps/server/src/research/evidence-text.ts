/**
 * Binary evidence extraction. Heavy binary deps (pdfium, workbook) load
 * lazily inside each branch so a missing binary breaks one upload with a
 * researcher-word 422 — never server boot. Pure helpers stay static.
 */
import { xmlToModel } from "@openwork/process-model/bpmn";

export type BinaryKind = "pdf" | "docx" | "bpmn" | "text";

export function kindFromFilename(name: string, category: string): BinaryKind {
  const lower = name.toLowerCase();
  if (lower.endsWith(".pdf")) return "pdf";
  if (lower.endsWith(".docx")) return "docx";
  if (lower.endsWith(".bpmn") || lower.endsWith(".xml")) return "bpmn";
  if (category === "bpmn") return "bpmn";
  return "text";
}

export interface ExtractedEvidence {
  text: string;
  taskLabels: string[];
}

const decoder = new TextDecoder("utf-8", { fatal: false });

export async function extractEvidenceText(
  name: string,
  category: string,
  bytes: Uint8Array,
): Promise<ExtractedEvidence> {
  const kind = kindFromFilename(name, category);
  if (kind === "pdf") {
    return { text: await extractPdfText(name, bytes), taskLabels: [] };
  }
  if (kind === "docx") {
    try {
      const { extractOfficeText } = await import("@openwork/workbook");
      return { text: await extractOfficeText("docx", bytes), taskLabels: [] };
    } catch {
      throw new Error(`${name} is not a readable Word document.`);
    }
  }
  const text = decoder.decode(bytes);
  if (kind === "bpmn") {
    let taskLabels: string[] = [];
    try {
      taskLabels = xmlToModel(text).steps.map((step) => step.label);
    } catch {
      taskLabels = [];
    }
    return { text, taskLabels };
  }
  return { text, taskLabels: [] };
}

async function extractPdfText(name: string, bytes: Uint8Array): Promise<string> {
  let withPdfDocument: (bytes: Uint8Array, work: (document: PdfDocument) => Promise<string>) => Promise<string>;
  try {
    ;({ withPdfDocument } = await import("../pdf-attachments/pdfium.js"));
  } catch {
    throw new Error(`${name} needs the PDF reader, which is unavailable in this runtime.`);
  }
  try {
    return await withPdfDocument(bytes, async (document) => {
      const pages: string[] = [];
      for (let page = 1; page <= document.info.pageCount; page += 1) {
        const text = document.pageText(page).trim();
        if (text) pages.push(`[page ${page}]\n${text}`);
      }
      if (pages.length === 0) {
        throw new Error(`${name} has no readable text.`);
      }
      return pages.join("\n\n");
    });
  } catch (error) {
    if (error instanceof Error && error.message.includes("readable text")) throw error;
    throw new Error(`${name} is not a readable PDF.`);
  }
}

interface PdfDocument {
  info: { pageCount: number };
  pageText(page: number): string;
}
