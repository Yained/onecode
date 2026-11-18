/** Scenario cards: 3 columns × 4 rows on desktop. */
export const CAPABILITY_PAGE_SIZE_SCENARIO = 12

/** Model / HPC / OneData public catalog cards: denser cards, ~4 columns × 4 rows. */
export const CAPABILITY_PAGE_SIZE_RESOURCE = 16

/** OneData raw / trainable list rows (taller than cards). */
export const CAPABILITY_PAGE_SIZE_ONEDATA_LIST = 8

/** @deprecated Prefer CAPABILITY_PAGE_SIZE_SCENARIO / CAPABILITY_PAGE_SIZE_RESOURCE. */
export const CAPABILITY_PAGE_SIZE = CAPABILITY_PAGE_SIZE_SCENARIO

export function totalPagesFor(total: number, pageSize: number) {
  if (total <= 0) return 0
  return Math.ceil(total / pageSize)
}

export function clampPage(page: number, totalPages: number) {
  if (totalPages <= 0) return 1
  if (!Number.isFinite(page) || page < 1) return 1
  if (page > totalPages) return totalPages
  return Math.floor(page)
}

export function paginate<T>(items: readonly T[], page: number, pageSize: number) {
  const total = items.length
  const totalPages = totalPagesFor(total, pageSize)
  const safePage = clampPage(page, totalPages)
  const start = totalPages === 0 ? 0 : (safePage - 1) * pageSize
  return {
    pageItems: items.slice(start, start + pageSize),
    page: safePage,
    totalPages,
    total,
    pageSize,
  }
}
