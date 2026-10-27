/** How many formats appear under "Recently used" before the rest, A–Z. */
const RECENT = 6;

type Format = { id: number; name: string; lastUsed?: string | null };

/**
 * The <option>s for a "where did you watch it" select: your most recently used formats first,
 * then everything else alphabetically. `formats` must already be in last-used order (listViewingFormats).
 */
export function FormatOptions({ formats }: { formats: Format[] }) {
  const recent = formats.filter((f) => f.lastUsed).slice(0, RECENT);
  const shown = new Set(recent.map((f) => f.id));
  const rest = formats.filter((f) => !shown.has(f.id)).sort((a, b) => a.name.localeCompare(b.name, "en-GB", { sensitivity: "base" }));
  return (
    <>
      {recent.length > 0 && (
        <optgroup label="Recently used">
          {recent.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
        </optgroup>
      )}
      <optgroup label={recent.length ? "All formats A–Z" : "Formats"}>
        {rest.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
      </optgroup>
    </>
  );
}
