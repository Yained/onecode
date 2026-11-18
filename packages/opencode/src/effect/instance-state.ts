import { Effect, Fiber, Option, ScopedCache, Scope, Context } from "effect"
import * as EffectLogger from "@opencode-ai/core/effect/logger"
import { Instance, type InstanceContext } from "@/project/instance"
import { LocalContext } from "@/util/local-context"
import { InstanceRef, WorkspaceRef } from "./instance-ref"
import { registerDisposer } from "./instance-registry"
import { WorkspaceContext } from "@/control-plane/workspace-context"
import * as PlatformAuth from "@/platform-auth/platform-auth"

const TypeId = "~opencode/InstanceState"

export interface InstanceState<A, E = never, R = never> {
  readonly [TypeId]: typeof TypeId
  readonly cache: ScopedCache.ScopedCache<string, A, E, R>
}

export const bind = <F extends (...args: any[]) => any>(fn: F): F => {
  try {
    return Instance.bind(fn)
  } catch (err) {
    if (!(err instanceof LocalContext.NotFound)) throw err
  }
  const fiber = Fiber.getCurrent()
  const ctx = fiber ? Context.getReferenceUnsafe(fiber.context, InstanceRef) : undefined
  if (!ctx) return fn
  return ((...args: any[]) => Instance.restore(ctx, () => fn(...args))) as F
}

export const context = Effect.gen(function* () {
  return (yield* InstanceRef) ?? Instance.current
})

export const workspaceID = Effect.gen(function* () {
  return (yield* WorkspaceRef) ?? WorkspaceContext.workspaceID
})

export const directory = Effect.map(context, (ctx) => ctx.directory)

/** Isolate InstanceState per platform account so provider credentials cannot leak across users on the same directory. */
export const cacheKey = Effect.gen(function* () {
  const dir = yield* directory
  const current = Option.getOrUndefined(yield* Effect.serviceOption(PlatformAuth.CurrentSession))
  const accountId = current?.session?.account.id
  return accountId ? `${accountId}\0${dir}` : dir
})

export const make = <A, E = never, R = never>(
  init: (ctx: InstanceContext) => Effect.Effect<A, E, R | Scope.Scope>,
): Effect.Effect<InstanceState<A, E, Exclude<R, Scope.Scope>>, never, R | Scope.Scope> =>
  Effect.gen(function* () {
    const keysByDirectory = new Map<string, Set<string>>()
    const cache = yield* ScopedCache.make<string, A, E, R>({
      capacity: Number.POSITIVE_INFINITY,
      lookup: () =>
        Effect.gen(function* () {
          const dir = yield* directory
          const key = yield* cacheKey
          const keys = keysByDirectory.get(dir) ?? new Set<string>()
          keys.add(key)
          keysByDirectory.set(dir, keys)
          return yield* init(yield* context)
        }),
    })

    const off = registerDisposer((directory) =>
      Effect.runPromise(
        Effect.gen(function* () {
          const keys = keysByDirectory.get(directory)
          keysByDirectory.delete(directory)
          if (keys) {
            for (const key of keys) {
              yield* ScopedCache.invalidate(cache, key)
            }
          }
          yield* ScopedCache.invalidate(cache, directory)
        }).pipe(Effect.provide(EffectLogger.layer)),
      ),
    )
    yield* Effect.addFinalizer(() => Effect.sync(off))

    return {
      [TypeId]: TypeId,
      cache,
    }
  })

export const get = <A, E, R>(self: InstanceState<A, E, R>) =>
  Effect.gen(function* () {
    return yield* ScopedCache.get(self.cache, yield* cacheKey)
  })

export const use = <A, E, R, B>(self: InstanceState<A, E, R>, select: (value: A) => B) => Effect.map(get(self), select)

export const useEffect = <A, E, R, B, E2, R2>(
  self: InstanceState<A, E, R>,
  select: (value: A) => Effect.Effect<B, E2, R2>,
) => Effect.flatMap(get(self), select)

export const has = <A, E, R>(self: InstanceState<A, E, R>) =>
  Effect.gen(function* () {
    return yield* ScopedCache.has(self.cache, yield* cacheKey)
  })

export const invalidate = <A, E, R>(self: InstanceState<A, E, R>) =>
  Effect.gen(function* () {
    const ref = yield* InstanceRef
    const dir =
      ref?.directory ??
      (yield* Effect.sync(() => {
        try {
          return Instance.current.directory
        } catch (err) {
          if (err instanceof LocalContext.NotFound) return undefined
          throw err
        }
      }))
    if (!dir) return
    const current = Option.getOrUndefined(yield* Effect.serviceOption(PlatformAuth.CurrentSession))
    const accountId = current?.session?.account.id
    const key = accountId ? `${accountId}\0${dir}` : dir
    return yield* ScopedCache.invalidate(self.cache, key)
  })

export * as InstanceState from "./instance-state"
