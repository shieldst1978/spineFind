/** TMDB's image widths that exist for posters (logos have w92 too, the most a logo here needs). */
const SIZES = [92, 154, 185, 342, 500, 780];

/**
 * next/image loader: every image in the app is a TMDB poster or logo, so ask TMDB's CDN for the
 * nearest size up instead of resizing it on the app's small container.
 */
export default function tmdbImageLoader({ src, width }: { src: string; width: number; quality?: number }) {
  const size = SIZES.find((s) => s >= width);
  return src.replace(/\/t\/p\/(w\d+|original)\//, `/t/p/${size ? `w${size}` : "original"}/`);
}
