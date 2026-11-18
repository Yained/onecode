/** Ambient types so typecheck works before CI installs postgres/mysql2. */
declare module "postgres" {
  type PostgresRow = Record<string, unknown>
  type PostgresSql = {
    unsafe(query: string, params?: readonly unknown[]): PromiseLike<Iterable<PostgresRow>>
    end(options?: { timeout?: number }): Promise<void>
  }
  export default function postgres(url: string, options?: Record<string, unknown>): PostgresSql
}

declare module "mysql2/promise" {
  export type Connection = {
    query(sql: string, values?: unknown[]): Promise<[unknown, unknown]>
    end(): Promise<void>
  }
  export function createConnection(config: Record<string, unknown>): Promise<Connection>
}
