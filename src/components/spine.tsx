import { swatch } from "@/lib/colours";

/** A book-spine style strip showing a box's colours, dominant colour largest. Plex films have none: an empty outline. */
export function Spine({ colours, className = "" }: { colours: string[]; className?: string }) {
  if (!colours.length) {
    return (
      <div className={`w-7 shrink-0 rounded-sm border border-dashed border-stone-300 dark:border-stone-600 ${className}`}
        title="No spine (Plex)" aria-label="No spine" />
    );
  }
  return (
    <div
      className={`flex w-7 shrink-0 flex-col overflow-hidden rounded-sm ring-1 ring-black/15 dark:ring-white/15 ${className}`}
      title={colours.join(" / ")}
      aria-label={`Spine: ${colours.join(", ")}`}
    >
      {colours.map((c, i) => (
        <div key={i} style={{ backgroundColor: swatch(c), flexGrow: i === 0 ? 3 : 1 }} />
      ))}
    </div>
  );
}
