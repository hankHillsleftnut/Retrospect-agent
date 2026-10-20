/**
 * Read every row, not just the first page.
 *
 * PostgREST returns at most 1,000 rows per request, silently, whatever
 * .limit() asks for (verified 19 Oct: asked for 5,000, got 1,000). Six reads
 * written that night assumed otherwise. This pages with .range() until a short
 * page comes back. Pass a builder factory with a stable .order().
 */
export const PAGE = 1000;

export async function selectAll<T>(
  page: (from: number, to: number) => PromiseLike<{ data: unknown; error: { message: string } | null }>,
  max = 50_000,
): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; from < max; from += PAGE) {
    const { data, error } = await page(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as T[];
    out.push(...rows);
    if (rows.length < PAGE) break;
  }
  return out;
}

/** Split a long id list for .in() lookups: hundreds of ids in one URL fail (#56). */
export function chunks<T>(xs: T[], size = 100): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += size) out.push(xs.slice(i, i + size));
  return out;
}
