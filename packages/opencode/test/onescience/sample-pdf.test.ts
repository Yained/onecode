import { describe, expect, test } from "bun:test"
import { mkdirSync, writeFileSync } from "fs"
import os from "os"
import path from "path"
import { samplePdf } from "../../src/onescience/sample-pdf"

function writeMinimalPdf(filePath: string, text: string) {
  const stream = `BT /F1 24 Tf 50 100 Td (${text}) Tj ET\n`
  const objects = [
    "1 0 obj<< /Type /Catalog /Pages 2 0 R >>endobj\n",
    "2 0 obj<< /Type /Pages /Kids [3 0 R] /Count 1 >>endobj\n",
    "3 0 obj<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 144] /Contents 4 0 R /Resources<< /Font<< /F1 5 0 R >> >> >>endobj\n",
    `4 0 obj<< /Length ${stream.length} >>stream\n${stream}endstream\nendobj\n`,
    "5 0 obj<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>endobj\n",
  ]
  let body = "%PDF-1.4\n"
  const offsets = [0]
  for (const object of objects) {
    offsets.push(Buffer.byteLength(body, "latin1"))
    body += object
  }
  const xrefStart = Buffer.byteLength(body, "latin1")
  body += `xref\n0 ${objects.length + 1}\n`
  body += "0000000000 65535 f \n"
  for (let i = 1; i < offsets.length; i++) {
    body += `${String(offsets[i]).padStart(10, "0")} 00000 n \n`
  }
  body += `trailer<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`
  writeFileSync(filePath, body, "latin1")
}

describe("samplePdf", () => {
  test("extracts text from a simple PDF", () => {
    const dir = path.join(os.tmpdir(), `pdf-sample-${Date.now()}`)
    mkdirSync(dir, { recursive: true })
    const file = path.join(dir, "hello.pdf")
    writeMinimalPdf(file, "Hello PDF preview")
    expect(samplePdf(file)).toContain("Hello PDF preview")
  })
})
