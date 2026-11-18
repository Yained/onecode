export function parseCsv(text: string) {
  const rows: string[][] = []
  let row: string[] = []
  let field = ""
  let quoted = false

  for (let index = 0; index < text.length; index++) {
    const char = text[index]!
    if (quoted) {
      if (char === '"') {
        if (text[index + 1] === '"') {
          field += '"'
          index++
          continue
        }
        quoted = false
        continue
      }
      field += char
      continue
    }

    if (char === '"') {
      quoted = true
      continue
    }
    if (char === ",") {
      row.push(field)
      field = ""
      continue
    }
    if (char === "\n") {
      row.push(field)
      rows.push(row)
      row = []
      field = ""
      continue
    }
    if (char === "\r") continue
    field += char
  }

  if (field.length > 0 || row.length > 0) {
    row.push(field)
    rows.push(row)
  }

  while (rows.length > 0 && rows[rows.length - 1]!.every((cell) => cell.trim() === "")) {
    rows.pop()
  }

  if (rows.length === 0) return { headers: [] as string[], rows: [] as string[][] }

  const headers = rows[0]!
  const width = Math.max(...rows.map((item) => item.length))
  const normalizedHeaders = Array.from({ length: width }, (_, index) => headers[index]?.trim() || `Column ${index + 1}`)
  const body = rows.slice(1).map((item) => Array.from({ length: width }, (_, index) => item[index] ?? ""))
  return { headers: normalizedHeaders, rows: body }
}
