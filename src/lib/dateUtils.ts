/**
 * Date formatting and parsing utilities for WM Manager Dashboard.
 * Standardized to DD-MM-YYYY format across all views, tables, cards, modals, and documents.
 */

export const pad = (n: number): string => String(n).padStart(2, '0');

/**
 * Parses any date value (DD-MM-YYYY, YYYY-MM-DD, ISO string, epoch ms, Date)
 * into milliseconds since epoch. Returns 0 if invalid or empty.
 */
export function parseDateToMs(val: string | number | Date | null | undefined): number {
  if (!val) return 0;
  if (typeof val === 'number') {
    return Number.isNaN(val) ? 0 : val;
  }
  if (val instanceof Date) {
    const t = val.getTime();
    return Number.isNaN(t) ? 0 : t;
  }
  const str = String(val).trim();
  if (!str) return 0;

  // DD-MM-YYYY or DD/MM/YYYY with optional time
  const dmyMatch = str.match(
    /^(\d{1,2})[-/](\d{1,2})[-/](\d{4})(?:[ T](\d{1,2}):(\d{1,2})(?::(\d{1,2}))?)?$/
  );
  if (dmyMatch) {
    const day = parseInt(dmyMatch[1], 10);
    const month = parseInt(dmyMatch[2], 10) - 1;
    const year = parseInt(dmyMatch[3], 10);
    const hours = dmyMatch[4] ? parseInt(dmyMatch[4], 10) : 0;
    const minutes = dmyMatch[5] ? parseInt(dmyMatch[5], 10) : 0;
    const seconds = dmyMatch[6] ? parseInt(dmyMatch[6], 10) : 0;
    const d = new Date(year, month, day, hours, minutes, seconds);
    return Number.isNaN(d.getTime()) ? 0 : d.getTime();
  }

  // YYYY-MM-DD or YYYY/MM/DD with optional time
  const ymdMatch = str.match(
    /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:[ T](\d{1,2}):(\d{1,2})(?::(\d{1,2}))?)?$/
  );
  if (ymdMatch) {
    const year = parseInt(ymdMatch[1], 10);
    const month = parseInt(ymdMatch[2], 10) - 1;
    const day = parseInt(ymdMatch[3], 10);
    const hours = ymdMatch[4] ? parseInt(ymdMatch[4], 10) : 0;
    const minutes = ymdMatch[5] ? parseInt(ymdMatch[5], 10) : 0;
    const seconds = ymdMatch[6] ? parseInt(ymdMatch[6], 10) : 0;
    const d = new Date(year, month, day, hours, minutes, seconds);
    return Number.isNaN(d.getTime()) ? 0 : d.getTime();
  }

  // Fallback to standard Date.parse (handling ISO strings, etc.)
  const parsed = Date.parse(str.includes(' ') && !str.includes('T') ? str.replace(' ', 'T') : str);
  return Number.isNaN(parsed) ? 0 : parsed;
}

/**
 * Formats a date value to DD-MM-YYYY (e.g. "28-10-2026").
 */
export function formatDate(val: string | number | Date | null | undefined): string {
  if (!val) return '';
  if (val instanceof Date) {
    if (Number.isNaN(val.getTime())) return '';
    return `${pad(val.getDate())}-${pad(val.getMonth() + 1)}-${val.getFullYear()}`;
  }
  if (typeof val === 'number') {
    return formatDate(new Date(val));
  }
  const str = String(val).trim();
  if (!str) return '';

  // If already DD-MM-YYYY
  const dmyMatch = str.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})/);
  if (dmyMatch) {
    return `${pad(parseInt(dmyMatch[1], 10))}-${pad(parseInt(dmyMatch[2], 10))}-${dmyMatch[3]}`;
  }

  // If YYYY-MM-DD
  const ymdMatch = str.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  if (ymdMatch) {
    return `${pad(parseInt(ymdMatch[3], 10))}-${pad(parseInt(ymdMatch[2], 10))}-${ymdMatch[1]}`;
  }

  const ms = parseDateToMs(str);
  if (ms > 0) {
    return formatDate(new Date(ms));
  }
  return str;
}

/**
 * Formats a date value with time as DD-MM-YYYY HH:mm:ss (or DD-MM-YYYY if no time component).
 */
export function formatDateTime(
  val: string | number | Date | null | undefined,
  includeSeconds = true
): string {
  if (!val) return '';
  if (val instanceof Date) {
    if (Number.isNaN(val.getTime())) return '';
    const dateStr = formatDate(val);
    const timeStr = `${pad(val.getHours())}:${pad(val.getMinutes())}${
      includeSeconds ? `:${pad(val.getSeconds())}` : ''
    }`;
    return `${dateStr} ${timeStr}`;
  }
  if (typeof val === 'number') {
    return formatDateTime(new Date(val), includeSeconds);
  }
  const str = String(val).trim();
  if (!str) return '';

  const dmyMatch = str.match(
    /^(\d{1,2})[-/](\d{1,2})[-/](\d{4})(?:[ T](\d{1,2}):(\d{1,2})(?::(\d{1,2}))?)?$/
  );
  if (dmyMatch) {
    const dStr = `${pad(parseInt(dmyMatch[1], 10))}-${pad(parseInt(dmyMatch[2], 10))}-${dmyMatch[3]}`;
    if (dmyMatch[4] !== undefined) {
      const tStr = `${pad(parseInt(dmyMatch[4], 10))}:${pad(parseInt(dmyMatch[5], 10))}${
        includeSeconds && dmyMatch[6] !== undefined
          ? `:${pad(parseInt(dmyMatch[6], 10))}`
          : includeSeconds
          ? ':00'
          : ''
      }`;
      return `${dStr} ${tStr}`;
    }
    return dStr;
  }

  const ymdMatch = str.match(
    /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:[ T](\d{1,2}):(\d{1,2})(?::(\d{1,2}))?)?$/
  );
  if (ymdMatch) {
    const dStr = `${pad(parseInt(ymdMatch[3], 10))}-${pad(parseInt(ymdMatch[2], 10))}-${ymdMatch[1]}`;
    if (ymdMatch[4] !== undefined) {
      const tStr = `${pad(parseInt(ymdMatch[4], 10))}:${pad(parseInt(ymdMatch[5], 10))}${
        includeSeconds && ymdMatch[6] !== undefined
          ? `:${pad(parseInt(ymdMatch[6], 10))}`
          : includeSeconds
          ? ':00'
          : ''
      }`;
      return `${dStr} ${tStr}`;
    }
    return dStr;
  }

  const ms = parseDateToMs(str);
  if (ms > 0) {
    return formatDateTime(new Date(ms), includeSeconds);
  }
  return str;
}

/**
 * Formats appointment date & time for compact card display:
 * e.g., "Wed, 28-10-2026 • 2:30 PM"
 */
export function formatDateTimeDisplay(scheduledAt: string, scheduledAtMs?: number): string {
  const ms = scheduledAtMs || parseDateToMs(scheduledAt);
  if (!ms) return scheduledAt || '';
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return scheduledAt || '';

  const weekday = d.toLocaleDateString('en-GB', { weekday: 'short' });
  const dayMonthYear = formatDate(d);
  const time = d.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });

  return `${weekday}, ${dayMonthYear} • ${time}`;
}

/**
 * Formats appointment date & time for modal display:
 * e.g., "Wednesday, 28-10-2026 at 2:30 PM"
 */
export function formatDateTimeModal(scheduledAt: string, scheduledAtMs?: number): string {
  const ms = scheduledAtMs || parseDateToMs(scheduledAt);
  if (!ms) return scheduledAt || '';
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return scheduledAt || '';

  const weekday = d.toLocaleDateString('en-GB', { weekday: 'long' });
  const dayMonthYear = formatDate(d);
  const time = d.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });

  return `${weekday}, ${dayMonthYear} at ${time}`;
}

/**
 * Formats a Date object to "DD-MM-YYYY HH:mm:ss" for database storage & state.
 */
export function formatTimestamp(date: Date = new Date()): string {
  return `${pad(date.getDate())}-${pad(date.getMonth() + 1)}-${date.getFullYear()} ${pad(
    date.getHours()
  )}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}
