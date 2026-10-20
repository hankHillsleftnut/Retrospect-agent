/**
 * The Supabase client's query interface, answered by real Postgres (PGlite).
 *
 * Code in this repo talks to the database through supabase-js builders:
 * `.from('raw_content').select('*').eq(...).lte(...)`. A hand-written fake of
 * those calls can only check that the code *asked* for something, never that
 * the question returns the right rows. This translates each builder into SQL
 * and runs it against a database built from the real migrations, so a test
 * exercises the same queries production runs, against the same constraints.
 *
 * Covers the subset of the builder this codebase uses. Anything else throws
 * loudly rather than being silently ignored, so a test can never pass because
 * a filter was dropped.
 */
import type { PGlite } from '@electric-sql/pglite' with { 'resolution-mode': 'import' };

type Row = Record<string, unknown>;
interface Result { data: any; error: { code?: string; message: string } | null; count?: number | null }

const ident = (name: string) => {
  if (!/^[a-z_][a-z0-9_]*$/i.test(name)) throw new Error(`supabase-on-pglite: unsupported identifier "${name}"`);
  return `"${name}"`;
};

class Query implements PromiseLike<Result> {
  private where: string[] = [];
  private params: unknown[] = [];
  private orderBy: string[] = [];
  private limitN: number | null = null;
  private offsetN = 0;
  private columns = '*';
  private countMode: { head: boolean } | null = null;
  private mode: 'select' | 'update' | 'insert' | 'upsert' | 'delete' = 'select';
  private payload: Row[] = [];
  private onConflict: string | null = null;
  private ignoreDuplicates = false;
  private returning = false;
  private cardinality: 'many' | 'single' | 'maybeSingle' = 'many';

  constructor(private db: PGlite, private table: string, private types: (t: string) => Promise<Map<string, string>>) {}

  private bind(value: unknown): string {
    this.params.push(value);
    return `$${this.params.length}`;
  }

  select(columns = '*', opts?: { count?: 'exact'; head?: boolean }) {
    if (this.mode !== 'select') this.returning = true;
    this.columns = columns.split(',').map((c) => c.trim()).filter(Boolean)
      .map((c) => (c === '*' ? '*' : ident(c))).join(', ') || '*';
    if (opts?.count) this.countMode = { head: Boolean(opts.head) };
    return this;
  }
  eq(c: string, v: unknown) { this.where.push(`${ident(c)} = ${this.bind(v)}`); return this; }
  neq(c: string, v: unknown) { this.where.push(`${ident(c)} IS DISTINCT FROM ${this.bind(v)}`); return this; }
  gt(c: string, v: unknown) { this.where.push(`${ident(c)} > ${this.bind(v)}`); return this; }
  gte(c: string, v: unknown) { this.where.push(`${ident(c)} >= ${this.bind(v)}`); return this; }
  lt(c: string, v: unknown) { this.where.push(`${ident(c)} < ${this.bind(v)}`); return this; }
  lte(c: string, v: unknown) { this.where.push(`${ident(c)} <= ${this.bind(v)}`); return this; }
  like(c: string, v: string) { this.where.push(`${ident(c)} LIKE ${this.bind(v)}`); return this; }
  ilike(c: string, v: string) { this.where.push(`${ident(c)} ILIKE ${this.bind(v)}`); return this; }
  is(c: string, v: null | boolean) {
    this.where.push(`${ident(c)} IS ${v === null ? 'NULL' : v ? 'TRUE' : 'FALSE'}`);
    return this;
  }
  not(c: string, op: string, v: unknown) {
    if (op !== 'is' || v !== null) throw new Error(`supabase-on-pglite: unsupported not(${op}, ${String(v)})`);
    this.where.push(`${ident(c)} IS NOT NULL`);
    return this;
  }
  in(c: string, values: unknown[]) {
    if (values.length === 0) { this.where.push('FALSE'); return this; }
    this.where.push(`${ident(c)} IN (${values.map((v) => this.bind(v)).join(', ')})`);
    return this;
  }
  match(obj: Row) { for (const [k, v] of Object.entries(obj)) this.eq(k, v); return this; }
  or(expr: string) {
    const parts = expr.split(',').map((p) => {
      const m = /^([a-z_]+)\.eq\.(.+)$/i.exec(p.trim());
      if (!m) throw new Error(`supabase-on-pglite: unsupported or() term "${p}"`);
      return `${ident(m[1]!)} = ${this.bind(m[2])}`;
    });
    this.where.push(`(${parts.join(' OR ')})`);
    return this;
  }
  order(c: string, opts?: { ascending?: boolean }) {
    this.orderBy.push(`${ident(c)} ${opts?.ascending === false ? 'DESC' : 'ASC'}`);
    return this;
  }
  limit(n: number) { this.limitN = n; return this; }
  /** PostgREST's inclusive range: rows from..to. */
  range(from: number, to: number) { this.offsetN = from; this.limitN = to - from + 1; return this; }
  single() { this.cardinality = 'single'; return this; }
  maybeSingle() { this.cardinality = 'maybeSingle'; return this; }

  update(values: Row) { this.mode = 'update'; this.payload = [values]; return this; }
  delete() { this.mode = 'delete'; return this; }
  insert(values: Row | Row[]) { this.mode = 'insert'; this.payload = Array.isArray(values) ? values : [values]; return this; }
  upsert(values: Row | Row[], opts?: { onConflict?: string; ignoreDuplicates?: boolean }) {
    this.mode = 'upsert';
    this.payload = Array.isArray(values) ? values : [values];
    this.onConflict = opts?.onConflict ?? 'id';
    this.ignoreDuplicates = Boolean(opts?.ignoreDuplicates);
    return this;
  }

  /** JSON columns need JSON text; everything else goes through as is. */
  private async value(column: string, v: unknown): Promise<string> {
    const type = (await this.types(this.table)).get(column);
    if (!type) throw new Error(`supabase-on-pglite: ${this.table} has no column "${column}"`);
    const isJson = type === 'json' || type === 'jsonb';
    // pgvector (a user-defined type) takes "[1,2,3]", as PostgREST sends it.
    const isVector = type === 'USER-DEFINED' && Array.isArray(v);
    return this.bind((isJson || isVector) && v !== null && v !== undefined ? JSON.stringify(v) : v);
  }

  private whereSql() { return this.where.length ? ` WHERE ${this.where.join(' AND ')}` : ''; }

  private async sql(): Promise<string> {
    const t = ident(this.table);
    const ret = this.returning || this.mode === 'select' ? ` RETURNING ${this.columns}` : '';
    switch (this.mode) {
      case 'select': {
        if (this.countMode) return `SELECT count(*)::int AS count FROM ${t}${this.whereSql()}`;
        const order = this.orderBy.length ? ` ORDER BY ${this.orderBy.join(', ')}` : '';
        const limit = (this.limitN !== null ? ` LIMIT ${Number(this.limitN)}` : '') + (this.offsetN ? ` OFFSET ${Number(this.offsetN)}` : '');
        return `SELECT ${this.columns} FROM ${t}${this.whereSql()}${order}${limit}`;
      }
      case 'update': {
        const sets: string[] = [];
        for (const [k, v] of Object.entries(this.payload[0]!)) sets.push(`${ident(k)} = ${await this.value(k, v)}`);
        // Values are bound before the WHERE clause's own parameters were, so
        // rebuild: bind sets first, then re-bind the filters.
        return `UPDATE ${t} SET ${sets.join(', ')}${this.whereSql()}${this.returning ? ` RETURNING ${this.columns}` : ''}`;
      }
      case 'delete':
        return `DELETE FROM ${t}${this.whereSql()}${this.returning ? ` RETURNING ${this.columns}` : ''}`;
      case 'insert':
      case 'upsert': {
        const cols = [...new Set(this.payload.flatMap((r) => Object.keys(r)))];
        const rows: string[] = [];
        for (const r of this.payload) {
          const vals: string[] = [];
          for (const c of cols) vals.push(c in r ? await this.value(c, r[c]) : 'DEFAULT');
          rows.push(`(${vals.join(', ')})`);
        }
        let conflict = '';
        if (this.mode === 'upsert') {
          const target = this.onConflict!.split(',').map((c) => ident(c.trim())).join(', ');
          const updates = cols.filter((c) => !this.onConflict!.split(',').map((x) => x.trim()).includes(c));
          conflict = this.ignoreDuplicates || updates.length === 0
            ? ` ON CONFLICT (${target}) DO NOTHING`
            : ` ON CONFLICT (${target}) DO UPDATE SET ${updates.map((c) => `${ident(c)} = EXCLUDED.${ident(c)}`).join(', ')}`;
        }
        return `INSERT INTO ${t} (${cols.map(ident).join(', ')}) VALUES ${rows.join(', ')}${conflict}${this.returning ? ` RETURNING ${this.columns}` : ''}`;
      }
    }
    void ret;
  }

  async run(): Promise<Result> {
    try {
      // An UPDATE binds its SET values after the filters were bound by the
      // builder calls; renumber by building SET first on a fresh parameter list.
      if (this.mode === 'update') {
        const filters = this.where;
        const filterParams = this.params;
        this.where = [];
        this.params = [];
        const set = await this.sql(); // binds SET values as $1..$k
        const offset = this.params.length;
        const shifted = filters.map((f) => f.replace(/\$(\d+)/g, (_, n) => `$${Number(n) + offset}`));
        this.params.push(...filterParams);
        const sql = set.replace(/( RETURNING .*)?$/, (m) => `${shifted.length ? ` WHERE ${shifted.join(' AND ')}` : ''}${m}`);
        return this.finish(await this.db.query<Row>(sql, this.params));
      }
      const sql = await this.sql();
      return this.finish(await this.db.query<Row>(sql, this.params));
    } catch (e) {
      const err = e as { code?: string; message?: string };
      return { data: null, error: { code: err.code, message: String(err.message ?? e) } };
    }
  }

  private finish(res: { rows: Row[] }): Result {
    if (this.countMode) {
      const count = Number(res.rows[0]?.count ?? 0);
      return { data: this.countMode.head ? null : [], error: null, count };
    }
    if (this.mode !== 'select' && !this.returning) return { data: null, error: null };
    // PostgREST sends timestamps as ISO strings; PGlite hands back Dates.
    const rows = res.rows.map((r) => Object.fromEntries(
      Object.entries(r).map(([k, v]) => [k, v instanceof Date ? v.toISOString() : v]))) as Row[];
    if (this.cardinality === 'single') {
      return rows.length === 1
        ? { data: rows[0], error: null }
        : { data: null, error: { code: 'PGRST116', message: `expected one row, got ${rows.length}` } };
    }
    if (this.cardinality === 'maybeSingle') {
      return rows.length <= 1
        ? { data: rows[0] ?? null, error: null }
        : { data: null, error: { code: 'PGRST116', message: `expected at most one row, got ${rows.length}` } };
    }
    return { data: rows, error: null };
  }

  then<A = Result, B = never>(ok?: ((r: Result) => A | PromiseLike<A>) | null, fail?: ((e: unknown) => B | PromiseLike<B>) | null) {
    return this.run().then(ok, fail);
  }
}

/** A client shaped like the Supabase one this repo uses, over a PGlite database. */
export function supabaseOnPglite(db: PGlite) {
  const cache = new Map<string, Map<string, string>>();
  const types = async (table: string) => {
    if (!cache.has(table)) {
      const { rows } = await db.query<{ column_name: string; data_type: string }>(
        `SELECT column_name, data_type FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1`,
        [table],
      );
      cache.set(table, new Map(rows.map((r) => [r.column_name, r.data_type])));
    }
    return cache.get(table)!;
  };
  return {
    from: (table: string) => new Query(db, table, types),
    async rpc(fn: string, args: Record<string, unknown>): Promise<Result> {
      const names = Object.keys(args);
      const call = `${ident(fn)}(${names.map((n, i) => `${ident(n)} => $${i + 1}`).join(', ')})`;
      const values = names.map((n) => {
        const v = args[n];
        return v !== null && typeof v === 'object' ? JSON.stringify(v) : v;
      });
      try {
        // PostgREST returns a list for set-returning functions, a value otherwise.
        const { rows: [proc] } = await db.query<{ set: boolean }>(`SELECT bool_or(proretset) AS set FROM pg_proc WHERE proname = $1`, [fn]);
        if (proc?.set) {
          const { rows } = await db.query<Row>(`SELECT * FROM ${call}`, values);
          return { data: rows.map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, v instanceof Date ? v.toISOString() : v]))), error: null };
        }
        const { rows } = await db.query<Row>(`SELECT ${call} AS result`, values);
        return { data: rows[0]?.result ?? null, error: null };
      } catch (e) {
        const err = e as { code?: string; message?: string };
        return { data: null, error: { code: err.code, message: String(err.message ?? e) } };
      }
    },
  };
}
