import { describe, expect, test } from "bun:test"
import {
  defaultOpencodeServerUrl,
  resolveCurrentServerUrl,
  resolveStoredDefaultServerUrl,
  setRuntimeServerUrl,
} from "./server-url"

describe("server url defaults", () => {
  test("uses the local opencode server as the browser default", () => {
    expect(defaultOpencodeServerUrl).toBe("http://127.0.0.1:4096")
  })

  test("uses the configured local server in development", () => {
    expect(
      resolveCurrentServerUrl({
        dev: true,
        host: undefined,
        port: undefined,
        hostname: "localhost",
        origin: "http://localhost:8004",
      }),
    ).toBe("http://127.0.0.1:4096")
  })

  test("uses the current origin in production previews", () => {
    expect(
      resolveCurrentServerUrl({
        dev: false,
        hostname: "onescience.ai",
        origin: "http://onescience.ai:8004",
      }),
    ).toBe("http://onescience.ai:8004")
  })

  test("does not use oc:// origin for packaged desktop API calls", () => {
    setRuntimeServerUrl(undefined)
    expect(
      resolveCurrentServerUrl({
        dev: false,
        hostname: "renderer",
        origin: "oc://renderer",
      }),
    ).toBe(defaultOpencodeServerUrl)

    setRuntimeServerUrl("http://127.0.0.1:54321/")
    expect(
      resolveCurrentServerUrl({
        dev: false,
        hostname: "renderer",
        origin: "oc://renderer",
      }),
    ).toBe("http://127.0.0.1:54321")
    setRuntimeServerUrl(undefined)
  })

  test("migrates legacy localhost defaults to the current local server", () => {
    expect(resolveStoredDefaultServerUrl("http://localhost:4096")).toBe("http://127.0.0.1:4096")
  })

  test("migrates old OneScience defaults to the configured fallback", () => {
    expect(resolveStoredDefaultServerUrl("http://127.0.0.1:4096")).toBe("http://127.0.0.1:4096")
  })
})
