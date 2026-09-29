/**
 * Title + year matching key shared by catalogue items and watches.
 *
 * Normalisation ignores case, accents, punctuation and spacing, treats "&" as
 * "and", and drops a leading or trailing article ("The Godfather" and
 * "Godfather, The" both become "godfather").
 */
export function normaliseTitle(title: string): string {
  let t = title
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim()
    .replace(/&/g, " and ");
  t = t.replace(/,\s*(the|a|an)$/, "").replace(/^(the|a|an)\s+/, "");
  return t.replace(/[^a-z0-9]+/g, "");
}

export function matchKey(title: string, year: number | null | undefined): string {
  return `${normaliseTitle(title)}|${year ?? ""}`;
}
