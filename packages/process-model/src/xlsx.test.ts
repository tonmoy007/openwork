import assert from "node:assert/strict"
import { test } from "node:test"
import { buildDecisionWorkbook, unzipWorkbook } from "@openwork/process-model/xlsx"

const decoder = new TextDecoder()

test("decision workbook unzips to a sheet with headers and rows", () => {
  const bytes = buildDecisionWorkbook([
    ["Step", "Decision", "Reason"],
    ["Ward Office Visit", "accepted", "Duplicates registry data"],
    ["Officer Reviews Claim", "accepted", "Required by law"],
  ])
  assert.ok(bytes.length > 500)
  const files = unzipWorkbook(bytes)
  assert.ok(files["xl/worksheets/sheet1.xml"])
  assert.ok(files["xl/workbook.xml"])
  const sheet = decoder.decode(files["xl/worksheets/sheet1.xml"])
  assert.ok(sheet.includes("Ward Office Visit"))
  assert.ok(sheet.includes("Duplicates registry data"))
  assert.ok(sheet.includes('r="A1"'))
})

test("special characters escape without breaking the sheet", () => {
  const bytes = buildDecisionWorkbook([["Step"], ["A & B <C> \"quoted\""]])
  const files = unzipWorkbook(bytes)
  const sheet = decoder.decode(files["xl/worksheets/sheet1.xml"])
  assert.ok(sheet.includes("A &amp; B &lt;C&gt; &quot;quoted&quot;"))
})
