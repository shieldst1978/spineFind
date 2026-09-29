export type ItemType = "film" | "tv_season" | "episode";

/**
 * Classifies a catalogue title. "Season 9 Episode 18" is a TV episode, while
 * "Star Wars: Episode IV" is a film; "Season" or "Series" means a TV season.
 */
export function itemTypeFor(title: string): ItemType {
  if (/\bseason\b.*\bepisode\b/i.test(title)) return "episode";
  if (/\b(season|series)\b/i.test(title)) return "tv_season";
  return "film";
}
