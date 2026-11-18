import { describe, expect, test } from "bun:test"
import {
  applyTerminalTheme,
  disposeIfDisposable,
  getHoveredLinkText,
  getSpeechRecognitionCtor,
  hasSetOption,
  isDisposable,
  setOptionIfSupported,
} from "./runtime-adapters"

describe("runtime adapters", () => {
  test("detects and disposes disposable values", () => {
    let count = 0
    const value = {
      dispose: () => {
        count += 1
      },
    }
    expect(isDisposable(value)).toBe(true)
    disposeIfDisposable(value)
    expect(count).toBe(1)
  })

  test("ignores non-disposable values", () => {
    expect(isDisposable({ dispose: "nope" })).toBe(false)
    expect(() => disposeIfDisposable({ dispose: "nope" })).not.toThrow()
  })

  test("sets options only when setter exists", () => {
    const calls: Array<[string, unknown]> = []
    const value = {
      setOption: (key: string, next: unknown) => {
        calls.push([key, next])
      },
    }
    expect(hasSetOption(value)).toBe(true)
    setOptionIfSupported(value, "fontFamily", "Berkeley Mono")
    expect(calls).toEqual([["fontFamily", "Berkeley Mono"]])
    expect(() => setOptionIfSupported({}, "fontFamily", "Berkeley Mono")).not.toThrow()
  })

  test("applies terminal theme through options and renderer.setTheme", () => {
    const themes: unknown[] = []
    const value = {
      options: { theme: { background: "#fcfcfc" } as Record<string, string> },
      renderer: {
        setTheme: (next: unknown) => {
          themes.push(next)
        },
      },
    }
    const next = {
      background: "#191515",
      foreground: "#d4d4d4",
      cursor: "#d4d4d4",
      selectionBackground: "#d4d4d440",
    }
    applyTerminalTheme(value, next)
    expect(value.options.theme).toEqual(next)
    expect(themes).toEqual([next])
    expect(() => applyTerminalTheme({}, next)).not.toThrow()
    expect(() => applyTerminalTheme({ options: {} }, next)).not.toThrow()
  })

  test("reads hovered link text safely", () => {
    expect(getHoveredLinkText({ currentHoveredLink: { text: "https://example.com" } })).toBe("https://example.com")
    expect(getHoveredLinkText({ currentHoveredLink: { text: 1 } })).toBeUndefined()
    expect(getHoveredLinkText(null)).toBeUndefined()
  })

  test("resolves speech recognition constructor with webkit precedence", () => {
    // oxlint-disable-next-line no-extraneous-class
    class SpeechCtor {}
    // oxlint-disable-next-line no-extraneous-class
    class WebkitCtor {}
    const ctor = getSpeechRecognitionCtor({
      SpeechRecognition: SpeechCtor,
      webkitSpeechRecognition: WebkitCtor,
    })
    expect(ctor).toBe(WebkitCtor)
  })

  test("returns undefined when no valid speech constructor exists", () => {
    expect(getSpeechRecognitionCtor({ SpeechRecognition: "nope" })).toBeUndefined()
    expect(getSpeechRecognitionCtor(undefined)).toBeUndefined()
  })
})
