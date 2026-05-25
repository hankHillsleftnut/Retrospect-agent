/**
 * Tiny CLI arg parser — no dependency. Supports --flag, --flag=value, --flag value, and bare flags.
 */
export function parseArgs(argv: string[] = process.argv.slice(2)): Record<string, string | boolean> {
  const out: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a.startsWith('--')) {
      const eq = a.indexOf('=');
      if (eq > -1) {
        out[a.slice(2, eq)] = a.slice(eq + 1);
      } else {
        const next = argv[i + 1];
        if (next && !next.startsWith('--')) {
          out[a.slice(2)] = next;
          i++;
        } else {
          out[a.slice(2)] = true;
        }
      }
    }
  }
  return out;
}

export function requireArg(args: Record<string, string | boolean>, name: string): string {
  const v = args[name];
  if (typeof v !== 'string' || !v) {
    console.error(`Missing required --${name}`);
    process.exit(1);
  }
  return v;
}

export function optBool(args: Record<string, string | boolean>, name: string): boolean {
  return args[name] === true || args[name] === 'true';
}

export function optStr(args: Record<string, string | boolean>, name: string): string | undefined {
  const v = args[name];
  return typeof v === 'string' ? v : undefined;
}

export function optNum(args: Record<string, string | boolean>, name: string): number | undefined {
  const v = args[name];
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v);
    return Number.isNaN(n) ? undefined : n;
  }
  return undefined;
}
