import { describe, expect, test } from "bun:test"
import { APICallError } from "ai"
import { isOverflowMessage, parseAPICallError } from "@/provider/error"
import { ProviderID } from "@/provider/schema"

const LLAMA_CPP_OVERFLOW =
  "Upstream stream ended before completion: Input length (92964 tokens) exceeds the maximum allowed length (74362 tokens). Use a shorter input or enable --allow-auto-truncate."

describe("provider overflow detection", () => {
  test("classifies llama.cpp n_ctx errors as overflow", () => {
    expect(isOverflowMessage(LLAMA_CPP_OVERFLOW)).toBe(true)
    expect(isOverflowMessage("Input length (92964 tokens) exceeds the maximum allowed length (74362 tokens).")).toBe(
      true,
    )
    expect(isOverflowMessage("Input length (265330) exceeds model's maximum context length (262144).")).toBe(true)
  })

  test("does not classify rate limits as overflow", () => {
    expect(isOverflowMessage("Rate limit exceeded, please retry after 30 seconds.")).toBe(false)
    expect(isOverflowMessage("Too many requests. Please slow down.")).toBe(false)
  })

  test("parseAPICallError marks llama.cpp overflow as context_overflow", () => {
    const parsed = parseAPICallError({
      providerID: ProviderID.make("onescience"),
      error: new APICallError({
        message: LLAMA_CPP_OVERFLOW,
        url: "http://47.84.183.235:18081/v1/chat/completions",
        requestBodyValues: {},
        statusCode: 400,
        responseHeaders: { "content-type": "application/json" },
        isRetryable: false,
      }),
    })
    expect(parsed.type).toBe("context_overflow")
  })
})
