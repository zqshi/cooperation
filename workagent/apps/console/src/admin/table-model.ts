export type AdminRow = Record<string, unknown>;

export function filterAdminRows(rows: AdminRow[], search: string, status: string): AdminRow[] {
  const needle = search.trim().toLocaleLowerCase();
  return rows.filter((row) => {
    if (status && String(row.status ?? "") !== status) return false;
    if (!needle) return true;
    return JSON.stringify(row).toLocaleLowerCase().includes(needle);
  });
}

export function paginateAdminRows<T>(rows: T[], page: number, pageSize: number): T[] {
  const start = (page - 1) * pageSize;
  return rows.slice(start, start + pageSize);
}
