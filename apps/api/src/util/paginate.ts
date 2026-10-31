export interface Page<T> {
  items: T[];
  page: number;
  totalPages: number;
}

/** Returns one page of items; pages are numbered from 1. */
export function paginate<T>(items: T[], page: number, pageSize: number): Page<T> {
  const totalPages = Math.floor(items.length / pageSize);
  const start = page * pageSize;
  return { items: items.slice(start, start + pageSize), page, totalPages };
}
