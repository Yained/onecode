import { describe, expect, test } from "bun:test"
import fs from "fs/promises"
import os from "os"
import path from "path"
import {
  ingestServerIdentityFile,
  isUnreachableOnThisHost,
  isWindowsIdentityPath,
  referencedIdentityPaths,
  releaseReplacedManagedIdentity,
  resolveIdentitySourcePath,
} from "../../src/server/ssh-identity-ingest"

const PRIVATE_KEY = "-----BEGIN OPENSSH PRIVATE KEY-----\nabc\n-----END OPENSSH PRIVATE KEY-----"

describe("ssh identity ingest", () => {
  test("classifies Windows laptop paths as unreachable on Linux", () => {
    expect(isWindowsIdentityPath("E:\\works\\keys\\id_rsa.txt")).toBe(true)
    expect(isWindowsIdentityPath("c:/Users/me/.ssh/id_ed25519")).toBe(true)
    expect(isWindowsIdentityPath("/home/onescience/.ssh/id_ed25519")).toBe(false)
    expect(isWindowsIdentityPath("~/.ssh/id_ed25519")).toBe(false)
    expect(isUnreachableOnThisHost("E:\\works\\keys\\id_rsa.txt")).toBe(process.platform !== "win32")
    expect(isUnreachableOnThisHost("/home/onescience/.ssh/id_ed25519")).toBe(process.platform === "win32")
  })

  test("copies a unix private key into the managed identity dir", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "ssh-ingest-"))
    const source = path.join(root, "id_ed25519")
    const destDir = path.join(root, "identities")
    await fs.writeFile(source, PRIVATE_KEY, { mode: 0o600 })

    const result = await ingestServerIdentityFile({ sourcePath: source, destDir, now: 1 })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.ingested).toBe(true)
    expect(result.keyPath.startsWith(destDir)).toBe(true)
    expect(await fs.readFile(result.keyPath, "utf8")).toContain("PRIVATE KEY")
  })

  test("reuses a key that is already in the managed dir", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "ssh-ingest-"))
    const destDir = path.join(root, "identities")
    await fs.mkdir(destDir, { recursive: true })
    const source = path.join(destDir, "already")
    await fs.writeFile(source, PRIVATE_KEY, { mode: 0o600 })

    const result = await ingestServerIdentityFile({ sourcePath: source, destDir })
    expect(result).toEqual({ ok: true, keyPath: source, ingested: false })
  })

  test("rejects missing or non-key files", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "ssh-ingest-"))
    expect(await ingestServerIdentityFile({ sourcePath: path.join(root, "missing"), destDir: root })).toEqual({
      ok: false,
      reason: "notFound",
    })
    const notes = path.join(root, "notes.txt")
    await fs.writeFile(notes, "not a key")
    expect(await ingestServerIdentityFile({ sourcePath: notes, destDir: root })).toEqual({
      ok: false,
      reason: "invalid",
    })
    const foreign = process.platform === "win32" ? "/home/onescience/.ssh/id_ed25519" : "E:\\keys\\id.txt"
    expect(await ingestServerIdentityFile({ sourcePath: foreign, destDir: root })).toEqual({
      ok: false,
      reason: "windows",
    })
  })

  test("expands ~ against the provided homedir", () => {
    expect(resolveIdentitySourcePath("~/.ssh/id_ed25519", "/home/onescience")).toBe(
      path.join("/home/onescience", ".ssh", "id_ed25519"),
    )
  })

  test("replacing a key deletes only that previous managed file", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "ssh-ident-gc-"))
    const identities = path.join(root, "identities")
    const outside = path.join(root, "user-ssh")
    await fs.mkdir(identities, { recursive: true })
    await fs.mkdir(outside, { recursive: true })
    const kept = path.join(identities, "2-current.txt")
    const previous = path.join(identities, "1-old.txt")
    const leftover = path.join(identities, "0-unrelated.txt")
    const personal = path.join(outside, "id_ed25519")
    await fs.writeFile(kept, PRIVATE_KEY, { mode: 0o600 })
    await fs.writeFile(previous, PRIVATE_KEY, { mode: 0o600 })
    await fs.writeFile(leftover, PRIVATE_KEY, { mode: 0o600 })
    await fs.writeFile(personal, PRIVATE_KEY, { mode: 0o600 })

    const referenced = await referencedIdentityPaths({
      core1: { auth: { type: "key", keyPath: kept } },
      other: { enabled: true },
    })
    expect(referenced.has(path.resolve(kept))).toBe(true)

    const removed = await releaseReplacedManagedIdentity({
      identityDirs: [identities],
      previousKeyPath: previous,
      keepKeyPath: kept,
      referenced,
    })
    expect(removed).toBe(path.resolve(previous))
    expect(await fs.access(kept).then(() => true, () => false)).toBe(true)
    expect(await fs.access(previous).then(() => true, () => false)).toBe(false)
    expect(await fs.access(leftover).then(() => true, () => false)).toBe(true)
    expect(await fs.access(personal).then(() => true, () => false)).toBe(true)
  })

  test("keeps the previous key when OpenSSH or another target still references it", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "ssh-ident-keep-"))
    const identities = path.join(root, "identities")
    await fs.mkdir(identities, { recursive: true })
    const previous = path.join(identities, "1-old.txt")
    const kept = path.join(identities, "2-current.txt")
    await fs.writeFile(previous, PRIVATE_KEY, { mode: 0o600 })
    await fs.writeFile(kept, PRIVATE_KEY, { mode: 0o600 })

    const referenced = await referencedIdentityPaths({
      core1: { auth: { type: "key", keyPath: previous } },
    })
    const removed = await releaseReplacedManagedIdentity({
      identityDirs: [identities],
      previousKeyPath: previous,
      keepKeyPath: kept,
      referenced,
    })
    expect(removed).toBeUndefined()
    expect(await fs.access(previous).then(() => true, () => false)).toBe(true)
  })
})
