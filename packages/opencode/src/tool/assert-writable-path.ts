import { Effect, Option } from "effect"
import * as PlatformAuth from "@/platform-auth/platform-auth"

/** Reject agent writes into Shared Cases (read-only for logged-in accounts). */
export const assertWritablePathEffect = Effect.fn("Tool.assertWritablePath")(function* (target: string) {
  const current = Option.getOrUndefined(yield* Effect.serviceOption(PlatformAuth.CurrentSession))
  const session = current?.session
  if (!session) return
  if (PlatformAuth.canWritePath(session, target)) return
  throw new Error("Shared cases are read-only. Fork the case into your workspace before editing.")
})
