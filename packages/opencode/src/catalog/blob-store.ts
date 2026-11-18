import { Global } from "@opencode-ai/core/global"
import path from "path"
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs"

export function primitiveBlobPath(primitiveId: string) {
  return path.join(Global.Path.data, "blobs", "primitives", `${primitiveId}.json`)
}

export function writePrimitiveBlob(primitiveId: string, payload: Record<string, unknown>) {
  const target = primitiveBlobPath(primitiveId)
  mkdirSync(path.dirname(target), { recursive: true })
  writeFileSync(target, JSON.stringify(payload, null, 2), "utf8")
  return target
}

export function readPrimitiveBlob(primitiveId: string) {
  const target = primitiveBlobPath(primitiveId)
  if (!existsSync(target)) return undefined
  return JSON.parse(readFileSync(target, "utf8")) as Record<string, unknown>
}

export function blobLocationRef(primitiveId: string) {
  const blobPath = primitiveBlobPath(primitiveId)
  return {
    type: "local_blob",
    path: path.relative(Global.Path.data, blobPath),
    absolutePath: blobPath,
    storage: "opencode-data",
  }
}

export function ensureBlobLocation(primitiveId: string, payload: Record<string, unknown>) {
  writePrimitiveBlob(primitiveId, payload)
  return blobLocationRef(primitiveId)
}

export * as CatalogBlobStore from "./blob-store"
