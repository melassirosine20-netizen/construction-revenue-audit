/**
 * Value coercion for normalization — Phase 3
 * Spec: docs/06-import-workflow.md
 *
 * Invalid financial values are NOT coerced to zero.
 * Empty optional → null. Invalid required → error.
 */
export type CoerceOk<T> = { ok: true; value: T };
export type CoerceErr = { ok: false; message: string };
export type CoerceResult<T> = CoerceOk<T> | CoerceErr;

function raw(v: unknown): string {
  if (v == null) return '';
  return String(v).trim();
}

/** Strip currency symbols, commas, parentheses-for-negative; parse decimal. */
export function coerceMoney(
  input: unknown,
  opts: { required: boolean; field: string },
): CoerceResult<number | null> {
  const s = raw(input);
  if (s === '') {
    if (opts.required) {
      return { ok: false, message: `${opts.field}: required monetary value is missing` };
    }
    return { ok: true, value: null };
  }

  let negative = false;
  let t = s;
  // Accounting: (123.45) → -123.45
  if (/^\(.*\)$/.test(t)) {
    negative = true;
    t = t.slice(1, -1);
  }
  // Leading minus or trailing CR
  if (t.startsWith('-')) {
    negative = true;
    t = t.slice(1);
  }
  if (/cr$/i.test(t)) {
    negative = true;
    t = t.replace(/cr$/i, '');
  }
  // Strip currency and grouping
  t = t.replace(/[$€£¥,\s]/g, '').trim();
  if (t === '' || t === '.') {
    return { ok: false, message: `${opts.field}: invalid monetary value "${s}"` };
  }
  const n = Number(t);
  if (!Number.isFinite(n)) {
    return { ok: false, message: `${opts.field}: invalid monetary value "${s}"` };
  }
  const value = negative ? -Math.abs(n) : n;
  // Round to 2 decimal places for currency consistency (schema NUMERIC(18,2))
  const rounded = Math.round(value * 100) / 100;
  return { ok: true, value: rounded };
}

export function coerceNumber(
  input: unknown,
  opts: { required: boolean; field: string },
): CoerceResult<number | null> {
  const s = raw(input);
  if (s === '') {
    if (opts.required) {
      return { ok: false, message: `${opts.field}: required number is missing` };
    }
    return { ok: true, value: null };
  }
  const t = s.replace(/,/g, '');
  const n = Number(t);
  if (!Number.isFinite(n)) {
    return { ok: false, message: `${opts.field}: invalid number "${s}"` };
  }
  return { ok: true, value: n };
}

export function coerceInteger(
  input: unknown,
  opts: { required: boolean; field: string },
): CoerceResult<number | null> {
  const r = coerceNumber(input, opts);
  if (!r.ok) return r;
  if (r.value == null) return r;
  if (!Number.isInteger(r.value)) {
    // Allow 1.0 → 1
    if (Number.isInteger(Math.round(r.value)) && Math.abs(r.value - Math.round(r.value)) < 1e-9) {
      return { ok: true, value: Math.round(r.value) };
    }
    return { ok: false, message: `${opts.field}: expected integer, got "${raw(input)}"` };
  }
  return { ok: true, value: r.value };
}

export function coerceString(
  input: unknown,
  opts: { required: boolean; field: string },
): CoerceResult<string | null> {
  const s = raw(input);
  if (s === '') {
    if (opts.required) {
      return { ok: false, message: `${opts.field}: required string is missing` };
    }
    return { ok: true, value: null };
  }
  return { ok: true, value: s };
}

/** Accept ISO dates (YYYY-MM-DD) and common US forms MM/DD/YYYY. */
export function coerceDate(
  input: unknown,
  opts: { required: boolean; field: string },
): CoerceResult<string | null> {
  const s = raw(input);
  if (s === '') {
    if (opts.required) {
      return { ok: false, message: `${opts.field}: required date is missing` };
    }
    return { ok: true, value: null };
  }
  // Already ISO date
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    const d = new Date(s + 'T00:00:00Z');
    if (Number.isNaN(d.getTime())) {
      return { ok: false, message: `${opts.field}: invalid date "${s}"` };
    }
    return { ok: true, value: s };
  }
  // MM/DD/YYYY
  const mdy = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s);
  if (mdy) {
    const mm = mdy[1].padStart(2, '0');
    const dd = mdy[2].padStart(2, '0');
    const iso = `${mdy[3]}-${mm}-${dd}`;
    const d = new Date(iso + 'T00:00:00Z');
    if (Number.isNaN(d.getTime())) {
      return { ok: false, message: `${opts.field}: invalid date "${s}"` };
    }
    return { ok: true, value: iso };
  }
  // YYYY/MM/DD
  const ymd = /^(\d{4})\/(\d{1,2})\/(\d{1,2})$/.exec(s);
  if (ymd) {
    const iso = `${ymd[1]}-${ymd[2].padStart(2, '0')}-${ymd[3].padStart(2, '0')}`;
    return { ok: true, value: iso };
  }
  return { ok: false, message: `${opts.field}: unrecognized date format "${s}"` };
}

export function coerceBoolean(
  input: unknown,
  opts: { required: boolean; field: string },
): CoerceResult<boolean | null> {
  const s = raw(input).toLowerCase();
  if (s === '') {
    if (opts.required) {
      return { ok: false, message: `${opts.field}: required boolean is missing` };
    }
    return { ok: true, value: null };
  }
  if (['true', '1', 'yes', 'y', 'x'].includes(s)) return { ok: true, value: true };
  if (['false', '0', 'no', 'n'].includes(s)) return { ok: true, value: false };
  return { ok: false, message: `${opts.field}: invalid boolean "${raw(input)}"` };
}

export function coerceEnum(
  input: unknown,
  opts: { required: boolean; field: string; values: string[] },
): CoerceResult<string | null> {
  const s = raw(input);
  if (s === '') {
    if (opts.required) {
      return { ok: false, message: `${opts.field}: required value is missing` };
    }
    return { ok: true, value: null };
  }
  const lower = s.toLowerCase();
  const match = opts.values.find((v) => v.toLowerCase() === lower);
  if (!match) {
    return {
      ok: false,
      message: `${opts.field}: invalid value "${s}"; expected one of ${opts.values.join(', ')}`,
    };
  }
  return { ok: true, value: match };
}
