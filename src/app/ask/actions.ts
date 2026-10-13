"use server";

import { redirect } from "next/navigation";
import { deleteConversation } from "@/db/assistant";

export async function removeConversation(id: string) {
  if (/^[0-9a-f-]{36}$/i.test(id)) await deleteConversation(id);
  redirect("/ask");
}
