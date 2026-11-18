import { describe, expect, test } from "bun:test"
import { isSmtpUnreachableError } from "@/messaging/smtp"

describe("isSmtpUnreachableError", () => {
  test("treats connect/read timeouts as unreachable", () => {
    expect(isSmtpUnreachableError(new Error("SMTP connect timed out (smtp.example.com:587)"))).toBe(true)
    expect(isSmtpUnreachableError(new Error("SMTP read timed out after 15000ms"))).toBe(true)
    expect(isSmtpUnreachableError(new Error("SMTP STARTTLS timed out (smtp.example.com)"))).toBe(true)
  })

  test("treats typical network isolation codes as unreachable", () => {
    for (const code of ["ETIMEDOUT", "ECONNREFUSED", "EHOSTUNREACH", "ENETUNREACH", "ENOTFOUND", "EAI_AGAIN"]) {
      const error = Object.assign(new Error("connect failed"), { code })
      expect(isSmtpUnreachableError(error)).toBe(true)
    }
  })

  test("does not treat SMTP auth or protocol errors as unreachable", () => {
    expect(isSmtpUnreachableError(new Error("SMTP error: 535 Login fail"))).toBe(false)
    expect(isSmtpUnreachableError(new Error("SMTP error: 550 User not found"))).toBe(false)
    expect(isSmtpUnreachableError(undefined)).toBe(false)
  })
})
