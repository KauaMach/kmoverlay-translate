const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;
const UNIT_STEP = 1024;
const BYTES_PER_KILOBYTE = UNIT_STEP;
const BYTES_PER_MEGABYTE = UNIT_STEP * BYTES_PER_KILOBYTE;
const BYTES_PER_GIGABYTE = UNIT_STEP * BYTES_PER_MEGABYTE;
const DISPLAYED_FRACTION_DIGITS = 1;
const DISPLAYED_FRACTION_SCALE = 10 ** DISPLAYED_FRACTION_DIGITS;

const decimalFormat = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: DISPLAYED_FRACTION_DIGITS });

/** Formats how long ago something happened, in the short style of the design ("há 12 min"). */
export function formatElapsed(elapsedMs: number): string {
  if (elapsedMs < MINUTE_MS) {
    return 'há menos de 1 min';
  }
  if (elapsedMs < HOUR_MS) {
    return `há ${Math.floor(elapsedMs / MINUTE_MS)} min`;
  }
  if (elapsedMs < DAY_MS) {
    return `há ${Math.floor(elapsedMs / HOUR_MS)} h`;
  }
  const days = Math.floor(elapsedMs / DAY_MS);
  return days === 1 ? 'há 1 dia' : `há ${days} dias`;
}

/** Formats a storage size with Brazilian decimal separators ("148 MB", "1,5 GB"). */
export function formatBytes(bytes: number): string {
  // Units are chosen after rounding, so a value just below the next unit
  // shows as "1 MB" instead of "1024 KB".
  const kilobytes = Math.round(bytes / BYTES_PER_KILOBYTE);
  if (kilobytes < UNIT_STEP) {
    return `${kilobytes} KB`;
  }
  const megabytes = bytes / BYTES_PER_MEGABYTE;
  if (Math.round(megabytes * DISPLAYED_FRACTION_SCALE) / DISPLAYED_FRACTION_SCALE < UNIT_STEP) {
    return `${decimalFormat.format(megabytes)} MB`;
  }
  return `${decimalFormat.format(bytes / BYTES_PER_GIGABYTE)} GB`;
}

/** Formats a queue position as a feminine ordinal, agreeing with "página" ("3ª"). */
export function formatQueuePosition(position: number): string {
  return `${position}ª`;
}
