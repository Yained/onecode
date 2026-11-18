import { Schema } from "effect"

export class ApiNotFoundError extends Schema.ErrorClass<ApiNotFoundError>("NotFoundError")(
  {
    name: Schema.Literal("NotFoundError"),
    data: Schema.Struct({
      message: Schema.String,
    }),
  },
  { httpApiStatus: 404 },
) {}

export function notFound(message: string) {
  return new ApiNotFoundError({
    name: "NotFoundError",
    data: { message },
  })
}

export class SshTargetBusyError extends Schema.ErrorClass<SshTargetBusyError>("SshTargetBusyError")(
  {
    name: Schema.Literal("SshTargetBusyError"),
    data: Schema.Struct({
      message: Schema.String,
    }),
  },
  { httpApiStatus: 409 },
) {}

export function sshTargetBusy(message: string) {
  return new SshTargetBusyError({
    name: "SshTargetBusyError",
    data: { message },
  })
}
