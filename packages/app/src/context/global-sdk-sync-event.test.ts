import { describe, expect, test } from "bun:test"
import { mapSyncEventToUiEvent } from "./global-sdk-sync-event"

describe("mapSyncEventToUiEvent", () => {
  test("maps versioned message.part.updated sync events into UI part updates", () => {
    const part = {
      id: "prt_1",
      sessionID: "ses_1",
      messageID: "msg_1",
      type: "tool",
      tool: "catalog_search",
    }
    expect(
      mapSyncEventToUiEvent({
        type: "sync",
        syncEvent: {
          id: "evt_1",
          type: "message.part.updated.1",
          data: { sessionID: "ses_1", part, time: 1 },
        },
      }),
    ).toMatchObject({
      id: "evt_1",
      type: "message.part.updated",
      properties: { sessionID: "ses_1", part, time: 1 },
    })
  })

  test("maps message.updated sync events", () => {
    const info = { id: "msg_1", sessionID: "ses_1", role: "assistant" }
    expect(
      mapSyncEventToUiEvent({
        type: "sync",
        syncEvent: {
          id: "evt_2",
          type: "message.updated.1",
          data: { sessionID: "ses_1", info },
        },
      }),
    ).toMatchObject({
      id: "evt_2",
      type: "message.updated",
      properties: { sessionID: "ses_1", info },
    })
  })

  test("keeps session.updated gated on a non-empty title", () => {
    expect(
      mapSyncEventToUiEvent({
        type: "sync",
        syncEvent: {
          type: "session.updated.1",
          data: { sessionID: "ses_1", info: { id: "ses_1" } },
        },
      }),
    ).toBeUndefined()
    expect(
      mapSyncEventToUiEvent({
        type: "sync",
        syncEvent: {
          id: "evt_3",
          type: "session.updated",
          aggregateID: "ses_1",
          data: { info: { id: "ses_1", title: "台风登陆" } },
        },
      }),
    ).toMatchObject({
      type: "session.updated",
      properties: { info: { id: "ses_1", title: "台风登陆" } },
    })
  })

  test("ignores unrelated payloads", () => {
    expect(mapSyncEventToUiEvent({ type: "message.part.updated", properties: {} })).toBeUndefined()
    expect(mapSyncEventToUiEvent({ type: "sync", syncEvent: { type: "todo.updated.1", data: {} } })).toBeUndefined()
  })
})
