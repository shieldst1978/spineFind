import { swatch } from "@/lib/colours";

/** A book-spine style strip showing a box's colours, dominant colour largest. */
export function Spine({ colours, className = "" }: { colours: string[]; className?: string }) {
  const bands = colours.length ? colours : ["Grey"];
  return (
    <div
      className={`flex w-7 shrink-0 flex-col overflow-hidden rounded-sm ring-1 ring-black/15 dark:ring-white/15 ${className}`}
      title={bands.join(" / ")}
      aria-label={`Spine: ${bands.join(", ")}`}
    >
      {bands.map((c, i) => (
        <div key={i} style={{ backgroundColor: swatch(c), flexGrow: i === 0 ? 3 : 1 }} />
      ))}
    </div>
  );
}
