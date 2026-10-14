/**
 * Deterministic claims extractor. Splits evidence text into sections and
 * emits one claim per substantive chunk with page estimates, tags, and a
 * stable hash. Pure function: same bytes always produce the same claims.
 * A non-empty file always yields at least one claim (whole-text fallback);
 * empty files yield none.
 */
import { createHash } from "node:crypto"
import type { Claim } from "@openwork/research-templates/ports"

const MIN_CHUNK_CHARS = 40
const MAX_QUOTE_CHARS = 280
const LINES_PER_PAGE = 45

const TAG_KEYWORDS: Array<{ tag: string; words: string[] }> = [
  { tag: "certificate", words: ["certificate", "certified", "attested"] },
  { tag: "registry", words: ["registry", "database", "record", "bris"] },
  { tag: "duplication", words: ["duplicat", "already holds", "same legal fact"] },
  { tag: "cost", words: ["taka", "fee", "cost", "payment", "charge"] },
  { tag: "travel", words: ["visit", "trip", "travel", "bus", "office"] },
  { tag: "form", words: ["form", "application", "field", "fill"] },
  { tag: "rework", words: ["reject", "resubmit", "missing", "wrong format"] },
  { tag: "legal", words: ["act", "section", "law", "legal", "clause", "circular"] },
  { tag: "delay", words: ["days", "weeks", "months", "delay", "waiting"] },
]

function tagsFor(text: string): string[] {
  const lower = text.toLowerCase()
  const tags: string[] = []
  for (const { tag, words } of TAG_KEYWORDS) {
    if (words.some((word) => lower.includes(word))) tags.push(tag)
  }
  return tags
}

function hashClaim(file_id: string, page: number, section: string, quote: string): string {
  return createHash("sha256")
    .update(`${file_id}:${page}:${section}:${quote}`)
    .digest("hex")
    .slice(0, 16)
}

/** One citable claim per BPMN task label so diagram steps draft normally. */
export function bpmnTaskClaims(file_id: string, labels: string[]): Claim[] {
  return labels.map((label, index) => {
    const quote = `BPMN task: ${label}`.slice(0, MAX_QUOTE_CHARS)
    return {
      claim_id: `${file_id}:bpmn-${index + 1}`,
      file_id,
      page: 1,
      section: label.slice(0, 80),
      quote,
      tags: ["evidence", "bpmn"],
      hash: hashClaim(file_id, 1, label, quote),
    }
  })
}

interface Chunk {
  section: string
  text: string
  line: number
}

function splitChunks(text: string): Chunk[] {
  const lines = text.split("\n")
  const chunks: Chunk[] = []
  let section = "body"
  let current: string[] = []
  let startLine = 0
  const flush = (line: number) => {
    const joined = current.join("\n").trim()
    if (joined.length >= MIN_CHUNK_CHARS) {
      chunks.push({ section, text: joined, line: startLine })
    }
    current = []
    startLine = line
  }
  lines.forEach((line, index) => {
    const heading = line.match(/^#{1,3}\s+(.*)$/) ?? line.match(/^([A-Z][A-Za-z ,'()-]{3,60})$/)
    if (heading) {
      flush(index)
      section = heading[1].trim().slice(0, 80)
    } else if (line.trim() === "") {
      flush(index + 1)
    } else {
      if (current.length === 0) startLine = index
      current.push(line)
    }
  })
  flush(lines.length)
  return chunks
}

export function extractClaims(
  file_id: string,
  text: string,
  file_type: string,
): Claim[] {
  const chunks = splitChunks(text)
  const claims = chunks.map((chunk, index) => {
    const quote = chunk.text.slice(0, MAX_QUOTE_CHARS)
    const page = Math.floor(chunk.line / LINES_PER_PAGE) + 1
    return {
      claim_id: `${file_id}:c${index + 1}`,
      file_id,
      page,
      section: chunk.section,
      quote,
      tags: ["evidence", file_type, ...tagsFor(chunk.text)],
      hash: hashClaim(file_id, page, chunk.section, quote),
    }
  })
  if (claims.length > 0) return claims
  const trimmed = text.trim()
  if (trimmed.length === 0) return []
  const quote = trimmed.slice(0, MAX_QUOTE_CHARS)
  return [
    {
      claim_id: `${file_id}:c1`,
      file_id,
      page: 1,
      section: "body",
      quote,
      tags: ["evidence", file_type, ...tagsFor(trimmed)],
      hash: hashClaim(file_id, 1, "body", quote),
    },
  ]
}
