import { describe, expect, test } from "bun:test"
import {
  migrateModelSelection,
  modelSelectionPersistKey,
  MODEL_SELECTION_WORKSPACE_KEY,
} from "./local-model-selection"

describe("model selection persist", () => {
  test("uses a workspace key when there is no session", () => {
    expect(modelSelectionPersistKey(undefined)).toBe(MODEL_SELECTION_WORKSPACE_KEY)
    expect(modelSelectionPersistKey("ses_1")).toBe("ses_1")
  })

  test("keeps the home-page model pick across migrate", () => {
    const model = { providerID: "custom", modelID: "gpt-5.6-sol" }
    expect(
      migrateModelSelection({
        pick: {
          [MODEL_SELECTION_WORKSPACE_KEY]: { model },
          ses_1: { model: { providerID: "opencode", modelID: "deepseek-v4-pro" } },
        },
      }),
    ).toEqual({
      session: {
        [MODEL_SELECTION_WORKSPACE_KEY]: { model },
        ses_1: { model: { providerID: "opencode", modelID: "deepseek-v4-pro" } },
      },
    })
  })
})
