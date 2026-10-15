import { redirect } from "next/navigation";

/**
 * The front page opens Log a watch, the thing done most. The Shelf lives at
 * /shelf; an old shelf link (a search, or "added" after saving a box) still
 * lands there with its filters.
 */
export default async function Home({ searchParams }: PageProps<"/">) {
  const sp = await searchParams;
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(sp)) for (const x of [v ?? []].flat()) params.append(k, x);
  redirect(params.size ? `/shelf?${params}` : "/watches/new");
}
