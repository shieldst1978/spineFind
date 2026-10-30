import { withBase } from "@/lib/base-path";

/**
 * A full-screen photo behind a section's pages: the portrait shot on phones, the landscape one on wider
 * screens, under a wash of the page colour so text and cards stay readable in light and dark mode.
 */
export function Backdrop({ photo }: { photo: "cinema" }) {
  const src = (o: string) => withBase(`/media/backgrounds/${photo}-${o}.webp`);
  return (
    <div aria-hidden className="pointer-events-none fixed left-0 top-0 -z-10 h-lvh w-full overflow-hidden">
      <picture>
        <source media="(min-aspect-ratio: 1/1)" srcSet={src("horiz")} />
        <img src={src("vert")} alt="" decoding="async" className="h-full w-full scale-105 object-cover blur-[2px]" />
      </picture>
      <div className="absolute inset-0 bg-[var(--background)]/70" />
    </div>
  );
}
