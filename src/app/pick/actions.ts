"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { markSeen } from "@/db/streaming";

/** "Seen it before": counts the film as watched from now on, then shows another pick. */
export async function seenItBefore(tmdbId: number, title: string, year: number | null, next: string) {
  if (Number.isInteger(tmdbId) && tmdbId > 0 && title) await markSeen(tmdbId, title, year);
  revalidatePath("/pick");
  redirect(next.startsWith("/pick") ? next : "/pick");
}
