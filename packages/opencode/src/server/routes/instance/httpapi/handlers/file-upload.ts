import { AppFileSystem } from "@opencode-ai/core/filesystem"
import { Bus } from "@/bus"
import * as InstanceState from "@/effect/instance-state"
import { File } from "@/file"
import { FileWatcher } from "@/file/watcher"
import { getAvailableDiskBytes } from "@/onescience/disk-space"
import * as PlatformAuth from "@/platform-auth/platform-auth"
import { Effect, Option, Stream } from "effect"
import { HttpRouter, HttpServerRequest, HttpServerResponse, Multipart } from "effect/unstable/http"
import path from "path"

const MAX_UPLOAD_BYTES = 512 * 1024 * 1024
/** Dialog uploads land under uploads/ and are capped tighter than project-tree uploads. */
const PROMPT_UPLOAD_MAX_BYTES = 100 * 1024 * 1024
/** OneData browser uploads under onedata/ — keep aligned with app ONEDATA_UPLOAD_MAX_FILE_BYTES. */
const ONEDATA_UPLOAD_MAX_BYTES = 200 * 1024 * 1024
const MAX_MULTIPART_BYTES = MAX_UPLOAD_BYTES + 1024 * 1024
const CRLF = new Uint8Array([13, 10])
const CRLFCRLF = new Uint8Array([13, 10, 13, 10])

function jsonError(status: number, message: string) {
  return HttpServerResponse.jsonUnsafe({ error: message, message }, { status })
}

function maxBytesForRelativePath(relative: string) {
  const norm = relative.replace(/\\/g, "/")
  if (norm === "uploads" || norm.startsWith("uploads/")) return PROMPT_UPLOAD_MAX_BYTES
  if (norm === "onedata" || norm.startsWith("onedata/")) return ONEDATA_UPLOAD_MAX_BYTES
  return MAX_UPLOAD_BYTES
}

type UploadFields = {
  relativeRaw: string
  overwrite: boolean
  bytes: Uint8Array
}

function isWebRequest(value: unknown): value is Request {
  return typeof Request !== "undefined" && value instanceof Request
}

type NodeRequestSource = AsyncIterable<Uint8Array> & {
  headers?: Record<string, string | string[] | undefined>
}

function isNodeRequestSource(value: unknown): value is NodeRequestSource {
  return typeof value === "object" && value !== null && Symbol.asyncIterator in value
}

const parseViaWebFormData = (source: Request) =>
  Effect.tryPromise({
    try: async (): Promise<UploadFields> => {
      const form = await source.formData()
      const relativeRaw = String(form.get("path") ?? "")
      const overwrite = String(form.get("overwrite") ?? "false").toLowerCase() === "true"
      const blob = form.get("file") ?? form.get("files")
      if (!(blob instanceof Blob)) throw new Error("Missing file")
      if (typeof blob.size === "number" && blob.size > MAX_UPLOAD_BYTES) {
        throw new Error(`File too large (max ${MAX_UPLOAD_BYTES} bytes)`)
      }
      const bytes = new Uint8Array(await blob.arrayBuffer())
      return { relativeRaw, overwrite, bytes }
    },
    catch: (error) => (error instanceof Error ? error : new Error(String(error))),
  })

/** NodeHttpServer exposes IncomingMessage as `source` — parse multipart from the Effect request stream. */
const parseViaMultipartStream = (request: HttpServerRequest.HttpServerRequest) =>
  Effect.gen(function* () {
    let relativeRaw = ""
    let overwrite = false
    let bytes: Uint8Array | undefined
    let fieldFileText: string | undefined

    yield* Stream.runForEach(request.multipartStream, (part) =>
      Effect.gen(function* () {
        if (Multipart.isField(part)) {
          if (part.key === "path") relativeRaw = part.value
          else if (part.key === "overwrite") overwrite = part.value.toLowerCase() === "true"
          else if (part.key === "file") fieldFileText = part.value
          return
        }
        if (Multipart.isFile(part) && part.key === "file") {
          bytes = yield* part.contentEffect
        }
      }),
    )

    // Effect defaults FieldMimeTypes to ["application/json"], so browsers uploading
    // .json (Content-Type: application/json) become Fields instead of Files.
    // Prefer real File parts; fall back to the misclassified field body.
    if (!bytes && fieldFileText !== undefined) {
      bytes = new TextEncoder().encode(fieldFileText)
    }
    if (!bytes) return yield* Effect.fail(new Error("Missing file"))
    return { relativeRaw, overwrite, bytes } satisfies UploadFields
  }).pipe(
    Effect.provide(
      Multipart.limitsServices({
        maxFileSize: MAX_UPLOAD_BYTES,
        maxTotalSize: MAX_UPLOAD_BYTES,
        // Empty list → use filename-based file detection (do not treat JSON as a form field).
        fieldMimeTypes: [],
      }),
    ),
    Effect.mapError((error) => {
      if (error instanceof Multipart.MultipartError) {
        if (error.reason._tag === "FileTooLarge" || error.reason._tag === "BodyTooLarge") {
          return new Error(`File too large (max ${MAX_UPLOAD_BYTES} bytes)`)
        }
        return new Error(error.message || "Invalid multipart body")
      }
      return error instanceof Error ? error : new Error(String(error))
    }),
  )

function headerValue(headers: NodeRequestSource["headers"], name: string) {
  const value = headers?.[name] ?? headers?.[name.toLowerCase()]
  if (Array.isArray(value)) return value[0]
  return value
}

function multipartBoundary(headers: NodeRequestSource["headers"]) {
  const contentType = headerValue(headers, "content-type")
  const match = contentType?.match(/(?:^|;)\s*boundary=(?:"([^"]+)"|([^;]+))/i)
  return (match?.[1] ?? match?.[2])?.trim()
}

async function readBody(source: NodeRequestSource) {
  const chunks: Uint8Array[] = []
  let total = 0
  for await (const chunk of source) {
    total += chunk.byteLength
    if (total > MAX_MULTIPART_BYTES) throw new Error(`File too large (max ${MAX_UPLOAD_BYTES} bytes)`)
    chunks.push(chunk)
  }
  const body = new Uint8Array(total)
  let offset = 0
  chunks.forEach((chunk) => {
    body.set(chunk, offset)
    offset += chunk.byteLength
  })
  return body
}

function asciiBytes(value: string) {
  return new TextEncoder().encode(value)
}

function indexOfBytes(input: Uint8Array, needle: Uint8Array, start = 0) {
  if (needle.length === 0) return start
  for (let index = start; index <= input.length - needle.length; index += 1) {
    if (input[index] !== needle[0]) continue
    let matched = true
    for (let offset = 1; offset < needle.length; offset += 1) {
      if (input[index + offset] === needle[offset]) continue
      matched = false
      break
    }
    if (matched) return index
  }
  return -1
}

function skipLineBreak(input: Uint8Array, index: number) {
  if (input[index] === 13 && input[index + 1] === 10) return index + 2
  if (input[index] === 10) return index + 1
  return index
}

function fieldName(headers: Record<string, string>) {
  const disposition = headers["content-disposition"]
  const match = disposition?.match(/(?:^|;)\s*name=(?:"([^"]*)"|([^;]*))/i)
  return match?.[1] ?? match?.[2]?.trim()
}

function partHeaders(raw: string) {
  return Object.fromEntries(
    raw.split(/\r\n|\n/).flatMap((line) => {
      const index = line.indexOf(":")
      if (index === -1) return []
      return [[line.slice(0, index).trim().toLowerCase(), line.slice(index + 1).trim()]]
    }),
  )
}

function parseMultipartBytes(body: Uint8Array, boundary: string | undefined): UploadFields {
  if (!boundary) throw new Error("Invalid multipart body")

  const decoder = new TextDecoder()
  const boundaryBytes = asciiBytes(`--${boundary}`)
  const nextBoundaryBytes = asciiBytes(`\r\n--${boundary}`)
  let relativeRaw = ""
  let overwrite = false
  let bytes: Uint8Array | undefined
  let partStart = indexOfBytes(body, boundaryBytes)

  while (partStart !== -1) {
    const afterBoundary = partStart + boundaryBytes.length
    if (body[afterBoundary] === 45 && body[afterBoundary + 1] === 45) break

    const headersStart = skipLineBreak(body, afterBoundary)
    const headersEnd = indexOfBytes(body, CRLFCRLF, headersStart)
    if (headersEnd === -1) throw new Error("Invalid multipart body")

    const contentStart = headersEnd + CRLFCRLF.length
    const nextBoundary = indexOfBytes(body, nextBoundaryBytes, contentStart)
    if (nextBoundary === -1) throw new Error("Invalid multipart body")

    const name = fieldName(partHeaders(decoder.decode(body.subarray(headersStart, headersEnd))))
    const content = body.subarray(contentStart, nextBoundary)
    if (name === "path") relativeRaw = decoder.decode(content)
    if (name === "overwrite") overwrite = decoder.decode(content).toLowerCase() === "true"
    if ((name === "file" || name === "files") && bytes === undefined) bytes = content

    partStart = nextBoundary + CRLF.length
  }

  if (!bytes) throw new Error("Missing file")
  if (bytes.byteLength > MAX_UPLOAD_BYTES) throw new Error(`File too large (max ${MAX_UPLOAD_BYTES} bytes)`)
  return { relativeRaw, overwrite, bytes }
}

const parseViaMultipartSource = (source: NodeRequestSource) =>
  Effect.tryPromise({
    try: async () => parseMultipartBytes(await readBody(source), multipartBoundary(source.headers)),
    catch: (error) => (error instanceof Error ? error : new Error(String(error))),
  })

function parseUploadFields(request: HttpServerRequest.HttpServerRequest) {
  // Web handler / tests pass a Fetch Request; listen() uses Node IncomingMessage.
  if (isWebRequest(request.source)) return parseViaWebFormData(request.source)
  if (isNodeRequestSource(request.source)) return parseViaMultipartSource(request.source)
  return parseViaMultipartStream(request)
}

export const fileUploadRoute = HttpRouter.use((router) =>
  Effect.gen(function* () {
    const file = yield* File.Service
    const appFs = yield* AppFileSystem.Service
    const bus = yield* Bus.Service

    yield* router.add(
      "GET",
      "/file/disk-space",
      Effect.gen(function* () {
        const ctx = yield* InstanceState.context
        const availableBytes = yield* Effect.tryPromise({
          try: () => getAvailableDiskBytes(ctx.directory),
          catch: (error) => (error instanceof Error ? error : new Error(String(error))),
        }).pipe(Effect.catch(() => Effect.succeed(undefined as number | undefined)))
        return HttpServerResponse.jsonUnsafe(availableBytes === undefined ? {} : { availableBytes })
      }),
    )

    yield* router.add(
      "POST",
      "/file/upload",
      Effect.gen(function* () {
        const request = yield* HttpServerRequest.HttpServerRequest
        const ctx = yield* InstanceState.context

        const current = Option.getOrUndefined(yield* Effect.serviceOption(PlatformAuth.CurrentSession))
        if (current?.session && !PlatformAuth.canWritePath(current.session, ctx.directory)) {
          return jsonError(403, "Shared cases are read-only. Fork the case into your workspace before uploading.")
        }

        const fields = yield* parseUploadFields(request)

        const relative = File.normalizeUploadRelativePath(fields.relativeRaw)
        if (!relative) {
          return jsonError(400, "Invalid upload path")
        }

        const maxBytes = maxBytesForRelativePath(relative)
        if (fields.bytes.byteLength > maxBytes) {
          return jsonError(413, `File too large (max ${maxBytes} bytes)`)
        }

        const full = path.join(ctx.directory, relative)
        if (current?.session && !PlatformAuth.canWritePath(current.session, full)) {
          return jsonError(403, "Shared cases are read-only. Fork the case into your workspace before uploading.")
        }

        const availableBytes = yield* Effect.tryPromise({
          try: () => getAvailableDiskBytes(ctx.directory),
          catch: () => new Error("disk"),
        }).pipe(Effect.catch(() => Effect.succeed(undefined as number | undefined)))

        if (availableBytes !== undefined && availableBytes >= 0 && fields.bytes.byteLength > availableBytes) {
          return jsonError(507, "Not enough disk space")
        }

        const exists = yield* appFs.existsSafe(full)
        if (exists && (yield* appFs.isDir(full))) {
          return jsonError(409, "Path is a directory")
        }

        const result = yield* file.upload(relative, fields.bytes, { overwrite: fields.overwrite })

        if (result.status === "written") {
          yield* bus.publish(File.Event.Edited, { file: relative })
          yield* bus.publish(FileWatcher.Event.Updated, {
            file: relative,
            event: exists ? "change" : "add",
          })
        }

        return HttpServerResponse.jsonUnsafe(result)
      }).pipe(
        Effect.catch((error) => {
          const message = error instanceof Error ? error.message : String(error)
          if (message.includes("read-only") || message.includes("Shared cases")) {
            return Effect.succeed(jsonError(403, message))
          }
          if (message.includes("Missing file") || message.includes("Invalid multipart")) {
            return Effect.succeed(jsonError(400, message))
          }
          if (message.includes("File too large")) {
            return Effect.succeed(jsonError(413, message))
          }
          if (message.includes("Access denied") || message.includes("Invalid upload")) {
            return Effect.succeed(jsonError(400, message))
          }
          return Effect.succeed(jsonError(500, message || "Upload failed"))
        }),
      ),
    )

    yield* router.add(
      "DELETE",
      "/file/upload",
      Effect.gen(function* () {
        const request = yield* HttpServerRequest.HttpServerRequest
        const ctx = yield* InstanceState.context
        const url = Option.getOrElse(HttpServerRequest.toURL(request), () => new URL(request.url, "http://localhost"))
        const relativeRaw = url.searchParams.get("path") ?? ""

        const current = Option.getOrUndefined(yield* Effect.serviceOption(PlatformAuth.CurrentSession))
        if (current?.session && !PlatformAuth.canWritePath(current.session, ctx.directory)) {
          return jsonError(403, "Shared cases are read-only. Fork the case into your workspace before deleting uploads.")
        }

        const relative = File.normalizeUploadRelativePath(relativeRaw)
        if (!relative) return jsonError(400, "Invalid upload path")
        const norm = relative.replace(/\\/g, "/")
        if (norm !== "uploads" && !norm.startsWith("uploads/")) {
          return jsonError(400, "Only files under uploads/ can be deleted via this endpoint")
        }

        const full = path.join(ctx.directory, relative)
        if (current?.session && !PlatformAuth.canWritePath(current.session, full)) {
          return jsonError(403, "Shared cases are read-only. Fork the case into your workspace before deleting uploads.")
        }

        const exists = yield* appFs.existsSafe(full)
        if (!exists) {
          return HttpServerResponse.jsonUnsafe({ path: relative, status: "missing" })
        }
        if (yield* appFs.isDir(full)) {
          return jsonError(409, "Path is a directory")
        }

        yield* appFs.remove(full).pipe(
          Effect.mapError((error) => (error instanceof Error ? error : new Error(String(error)))),
        )
        yield* bus.publish(File.Event.Edited, { file: relative })
        yield* bus.publish(FileWatcher.Event.Updated, {
          file: relative,
          event: "unlink",
        })
        return HttpServerResponse.jsonUnsafe({ path: relative, status: "deleted" })
      }).pipe(
        Effect.catch((error) => {
          const message = error instanceof Error ? error.message : String(error)
          if (message.includes("read-only") || message.includes("Shared cases")) {
            return Effect.succeed(jsonError(403, message))
          }
          if (message.includes("Access denied") || message.includes("Invalid upload")) {
            return Effect.succeed(jsonError(400, message))
          }
          return Effect.succeed(jsonError(500, message || "Delete failed"))
        }),
      ),
    )
  }),
)
