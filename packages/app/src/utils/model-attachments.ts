export type InputModality = "text" | "image" | "audio" | "video" | "pdf"

type ModelInputCapabilities = {
  capabilities?: {
    input: Partial<Record<InputModality, boolean>>
  }
  modalities?: {
    input?: string[]
  }
}

export function attachmentModality(mime: string): InputModality | undefined {
  const type = mime.split(";", 1)[0]?.trim().toLowerCase() ?? ""
  if (type.startsWith("image/")) return "image"
  if (type.startsWith("audio/")) return "audio"
  if (type.startsWith("video/")) return "video"
  if (type === "application/pdf") return "pdf"
  return undefined
}

export function modelSupportsModality(model: ModelInputCapabilities, modality: InputModality): boolean {
  if (modality === "text") return true
  if (model.capabilities?.input) return model.capabilities.input[modality] === true
  const raw = model.modalities?.input
  if (!raw) return false
  return raw.includes(modality)
}

export function findUnsupportedAttachments(
  model: ModelInputCapabilities,
  attachments: Array<{ mime: string; filename?: string }>,
) {
  const result: Array<{ filename?: string; modality: InputModality }> = []
  for (const attachment of attachments) {
    const modality = attachmentModality(attachment.mime)
    if (!modality) continue
    if (!modelSupportsModality(model, modality)) {
      result.push({ filename: attachment.filename, modality })
    }
  }
  return result
}
