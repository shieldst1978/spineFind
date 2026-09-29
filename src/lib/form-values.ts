/** Shared parsing and checks for form fields, so adding and editing agree. */

export const text = (v: FormDataEntryValue | null) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim() : "");

/** Today's date in the UK as YYYY-MM-DD. */
export const todayUk = () => new Date().toLocaleDateString("en-CA", { timeZone: "Europe/London" });

/** A release year, or null when blank. Returns an error message when it's not a sensible year. */
export function parseYear(raw: string): { year: number | null } | { error: string } {
  if (!raw) return { year: null };
  const year = Number(raw);
  if (!Number.isInteger(year) || year < 1880 || year > new Date().getFullYear() + 2) {
    return { error: "The release year should be a four-digit year, like 1986." };
  }
  return { year };
}

/** A watch date; blank means today. Rejects the future and nonsense. */
export function parseWatchDate(raw: string): { date: string } | { error: string } {
  const today = todayUk();
  const date = raw || today;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date > today || date < "1900-01-01") {
    return { error: "Check the date. It can't be in the future." };
  }
  return { date };
}

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
