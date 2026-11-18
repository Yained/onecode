export class CatalogError extends Error {
  readonly status: number
  readonly error: string
  constructor(status: number, error: string, message: string) {
    super(message)
    this.status = status
    this.error = error
  }
}

export function catalogBadRequest(message: string) {
  return new CatalogError(400, "bad_request", message)
}

export function catalogForbidden(message: string) {
  return new CatalogError(403, "forbidden", message)
}

export function catalogUnavailable(message: string) {
  return new CatalogError(503, "object_store_key_unavailable", message)
}

export function catalogUnreachable(message: string) {
  return new CatalogError(422, "path_unreachable", message)
}
