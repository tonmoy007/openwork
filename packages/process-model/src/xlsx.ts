/**
 * Minimal decision-record XLSX writer. Single sheet, inline strings
 * (no shared-string table), zipped with fflate. Verified structurally
 * in tests; readability cross-checked with @openwork/workbook's reader.
 */
import { unzipSync, zipSync } from "fflate"

function escapeXml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
}

function columnLetters(index: number): string {
  let letters = ""
  let value = index
  do {
    letters = String.fromCharCode(65 + (value % 26)) + letters
    value = Math.floor(value / 26) - 1
  } while (value >= 0)
  return letters
}

function sheetXml(rows: string[][]): string {
  const dimension =
    rows.length === 0 ? "A1" : `A1:${columnLetters(rows[0].length - 1)}${rows.length}`
  const body = rows
    .map((cells, rowIndex) => {
      const items = cells
        .map(
          (cell, columnIndex) =>
            `<c r="${columnLetters(columnIndex)}${rowIndex + 1}" t="inlineStr"><is><t>${escapeXml(cell)}</t></is></c>`,
        )
        .join("")
      return `<row r="${rowIndex + 1}">${items}</row>`
    })
    .join("")
  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><dimension ref="${dimension}"/><sheetData>${body}</sheetData></worksheet>`
  )
}

const CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>`
const RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`
const WORKBOOK = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Decisions" sheetId="1" r:id="rId1"/></sheets></workbook>`
const WORKBOOK_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`

const encoder = new TextEncoder()

export function buildDecisionWorkbook(rows: string[][]): Uint8Array {
  return zipSync({
    "[Content_Types].xml": encoder.encode(CONTENT_TYPES),
    "_rels/.rels": encoder.encode(RELS),
    "xl/workbook.xml": encoder.encode(WORKBOOK),
    "xl/_rels/workbook.xml.rels": encoder.encode(WORKBOOK_RELS),
    "xl/worksheets/sheet1.xml": encoder.encode(sheetXml(rows)),
  })
}

export function unzipWorkbook(bytes: Uint8Array): Record<string, Uint8Array> {
  return unzipSync(bytes)
}
