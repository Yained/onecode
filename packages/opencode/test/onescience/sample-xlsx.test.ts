import { describe, expect, test } from "bun:test"
import { mkdirSync, writeFileSync } from "fs"
import os from "os"
import path from "path"
import { BlobWriter, TextReader, ZipWriter } from "@zip.js/zip.js"
import { sampleXlsx } from "../../src/onescience/sample-xlsx"

async function writeMinimalXlsx(filePath: string) {
  const writer = new ZipWriter(new BlobWriter("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"))
  await writer.add(
    "[Content_Types].xml",
    new TextReader(`<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
  <Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/>
</Types>`),
  )
  await writer.add(
    "xl/workbook.xml",
    new TextReader(`<?xml version="1.0" encoding="UTF-8"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheets><sheet name="Sheet1" sheetId="1" r:id="rId1" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"/></sheets>
</workbook>`),
  )
  await writer.add(
    "xl/sharedStrings.xml",
    new TextReader(`<?xml version="1.0" encoding="UTF-8"?>
<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="3" uniqueCount="3">
  <si><t>name</t></si>
  <si><t>value</t></si>
  <si><t>alpha</t></si>
</sst>`),
  )
  await writer.add(
    "xl/worksheets/sheet1.xml",
    new TextReader(`<?xml version="1.0" encoding="UTF-8"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetData>
    <row r="1">
      <c r="A1" t="s"><v>0</v></c>
      <c r="B1" t="s"><v>1</v></c>
    </row>
    <row r="2">
      <c r="A2" t="s"><v>2</v></c>
      <c r="B2"><v>42</v></c>
    </row>
  </sheetData>
</worksheet>`),
  )
  const blob = await writer.close()
  writeFileSync(filePath, Buffer.from(await blob.arrayBuffer()))
}

describe("sampleXlsx", () => {
  test("renders the first sheet as TSV", async () => {
    const dir = path.join(os.tmpdir(), `xlsx-sample-${Date.now()}`)
    mkdirSync(dir, { recursive: true })
    const file = path.join(dir, "demo.xlsx")
    await writeMinimalXlsx(file)
    const sample = await sampleXlsx(file)
    expect(sample).toBe("name\tvalue\nalpha\t42")
  })
})
