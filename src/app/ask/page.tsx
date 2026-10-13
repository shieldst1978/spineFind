import type Anthropic from "@anthropic-ai/sdk";
import type { Metadata } from "next";
import Link from "next/link";
import { AskChat, type ChatItem } from "@/components/ask-chat";
import { getConversation, listConversations } from "@/db/assistant";
import { toolStatus } from "@/lib/assistant/tools";
import { removeConversation } from "./actions";

export const metadata: Metadata = { title: "Ask · SpineFind" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A few of Tim's own questions, as tappable starters. */
const STARTERS = [
  "Given my watching history, recommend me a film to watch tonight from the shelf",
  "Which unwatched films do I have under 90 mins?",
  "What haven't I watched in ages?",
  "Which directors or actors do I keep coming back to?",
  "Can you create me a double feature pairing in the horror genre? Anything",
  "Something underrated on my streaming services I haven't seen",
];

/** Stored API messages → what the chat shows: your questions, and each answer's text and the tools it used. */
function toChat(messages: { role: string; content: unknown }[]): ChatItem[] {
  const items: ChatItem[] = [];
  for (const m of messages) {
    const blocks = (Array.isArray(m.content) ? m.content : []) as Anthropic.ContentBlock[] | Anthropic.ToolResultBlockParam[];
    if (m.role === "user") {
      const text = (blocks as { type: string; text?: string }[]).filter((b) => b.type === "text").map((b) => b.text).join("\n");
      if (text) items.push({ role: "user", text });
      continue;
    }
    const last = items.at(-1);
    const answer = last?.role === "assistant" ? last : (items.push({ role: "assistant", text: "", tools: [] }), items.at(-1)!);
    for (const b of blocks as Anthropic.ContentBlock[]) {
      if (b.type === "text" && b.text) answer.text += (answer.text ? "\n\n" : "") + b.text;
      if ((b.type === "tool_use" || b.type === "server_tool_use") && answer.role === "assistant") {
        const s = toolStatus(b.name).replace(/…$/, "");
        if (!answer.tools!.includes(s)) answer.tools!.push(s);
      }
    }
  }
  return items;
}

export default async function AskPage({ searchParams }: PageProps<"/ask">) {
  const sp = await searchParams;
  const c = typeof sp.c === "string" && UUID.test(sp.c) ? sp.c : null;
  const [conversation, past] = await Promise.all([c ? getConversation(c) : null, listConversations()]);
  const configured = Boolean(process.env.FOUNDRY_API_KEY && process.env.ASSISTANT_DATABASE_URL);

  return (
    <main className="mx-auto w-full min-w-0 max-w-2xl flex-1 space-y-4 px-4 py-6">
      <header className="flex items-baseline justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">Ask</h1>
        {conversation && <Link href="/ask" className="shrink-0 rounded-lg border border-stone-300 px-3 py-1.5 text-sm dark:border-stone-700">New conversation</Link>}
      </header>

      {past.length > 0 && (
        <details className="rounded-lg border border-stone-200 bg-white text-sm dark:border-stone-800 dark:bg-stone-900">
          <summary className="cursor-pointer px-3 py-2 text-stone-600 dark:text-stone-400">Past conversations ({past.length})</summary>
          <ul className="divide-y divide-stone-100 border-t border-stone-100 dark:divide-stone-800 dark:border-stone-800">
            {past.map((p) => (
              <li key={p.id} className="flex items-center gap-2 px-3 py-2">
                <Link href={`/ask?c=${p.id}`} className={`min-w-0 flex-1 truncate ${p.id === c ? "font-medium" : ""}`}>{p.title}</Link>
                <span className="shrink-0 text-xs text-stone-500">{p.updatedAt.toLocaleDateString("en-GB", { day: "numeric", month: "short" })}</span>
              </li>
            ))}
          </ul>
        </details>
      )}

      {!configured ? (
        <p className="rounded-lg border border-dashed border-stone-300 p-4 text-sm text-stone-600 dark:border-stone-700 dark:text-stone-400">
          The assistant isn&apos;t set up on this server yet.
        </p>
      ) : (
        <AskChat key={c ?? "new"} conversationId={c} initial={conversation ? toChat(conversation.messages) : []} starters={STARTERS} />
      )}

      {conversation && (
        <form action={removeConversation.bind(null, conversation.id)} className="text-right">
          <button type="submit" className="rounded px-2 py-1 text-xs text-stone-500 underline hover:bg-stone-100 dark:hover:bg-stone-800">Delete this conversation</button>
        </form>
      )}
      <p className="text-xs text-stone-500">Answers come from Claude (via Microsoft Foundry) reading your SpineFind data. It can&apos;t change anything. Check anything important.</p>
    </main>
  );
}
