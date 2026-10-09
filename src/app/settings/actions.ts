"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { setSubscribed } from "@/db/streaming";

/** Saves the ticked streaming services. Services not shown on the page were never ticked, so nothing is lost. */
export async function saveServices(form: FormData) {
  const ids = form.getAll("provider").map(String).filter((v) => /^\d{1,9}$/.test(v)).map(Number);
  await setSubscribed([...new Set(ids)]);
  revalidatePath("/", "layout");
  redirect(`/settings?saved=1${form.get("all") === "1" ? "&all=1" : ""}`);
}
