"use client";

import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { withBase } from "@/lib/base-path";

export type ChatItem = { role: "user"; text: string } | { role: "assistant"; text: string; tools?: string[]; status?: string; error?: string; cost?: number };

/** The chat: past messages, starters for a new conversation, and an answer streamed in as it's written. */
export function AskChat({ conversationId, initial, starters }: { conversationId: string | null; initial: ChatItem[]; starters: string[] }) {
  const [items, setItems] = useState<ChatItem[]>(initial);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const idRef = useRef(conversationId);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => { endRef.current?.scrollIntoView({ block: "end" }); }, [items.length]);

  const updateAnswer = (patch: (a: Extract<ChatItem, { role: "assistant" }>) => void) =>
    setItems((xs) => {
      const copy = [...xs];
      const a = { ...(copy.at(-1) as Extract<ChatItem, { role: "assistant" }>) };
      patch(a);
      copy[copy.length - 1] = a;
      return copy;
    });

  async function send(text: string) {
    const message = text.trim();
    if (!message || busy) return;
    setBusy(true);
    setInput("");
    setItems((xs) => [...xs, { role: "user", text: message }, { role: "assistant", text: "", tools: [], status: "Thinking…" }]);
    try {
      const res = await fetch(withBase("/ask/stream"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conversationId: idRef.current, message }),
      });
      if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.trim()) continue;
          const e = JSON.parse(line);
          if (e.type === "conversation" && idRef.current !== e.id) {
            idRef.current = e.id;
            // Keep the address in step so a reload (or the back button) returns to this conversation.
            window.history.replaceState(null, "", withBase(`/ask?c=${e.id}`));
          } else if (e.type === "text") {
            updateAnswer((a) => { a.text += e.delta; a.status = undefined; });
          } else if (e.type === "status") {
            const tool = e.text.replace(/…$/, "");
            updateAnswer((a) => { a.status = e.text; if (!a.tools?.includes(tool)) a.tools = [...(a.tools ?? []), tool]; });
          } else if (e.type === "error") {
            updateAnswer((a) => { a.error = e.message; a.status = undefined; });
          } else if (e.type === "done") {
            updateAnswer((a) => { a.status = undefined; a.cost = e.costUsd; });
          }
        }
      }
    } catch {
      updateAnswer((a) => { a.error = "Couldn't reach SpineFind. If it has just been updated, reload the page."; a.status = undefined; });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      {items.length === 0 && (
        <section className="space-y-2">
          <p className="text-sm text-stone-600 dark:text-stone-400">Ask anything about your collection and watching. For example:</p>
          <ul className="flex flex-col gap-2">
            {starters.map((s) => (
              <li key={s}>
                <button type="button" onClick={() => send(s)} disabled={busy}
                  className="w-full rounded-lg border border-stone-200 bg-white px-3 py-2 text-left text-sm hover:bg-stone-50 dark:border-stone-800 dark:bg-stone-900 dark:hover:bg-stone-800">
                  {s}
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <ol className="space-y-4">
        {items.map((m, i) => (
          <li key={i} className={m.role === "user" ? "flex justify-end" : ""}>
            {m.role === "user" ? (
              <p className="max-w-[85%] whitespace-pre-wrap break-words rounded-2xl rounded-br-sm bg-stone-900 px-3 py-2 text-sm text-white dark:bg-stone-100 dark:text-stone-900">{m.text}</p>
            ) : (
              <div className="space-y-1.5">
                {m.tools && m.tools.length > 0 && <p className="text-xs text-stone-500">{m.tools.join(" · ")}</p>}
                {m.text && (
                  <div className="prose-answer break-words text-sm leading-relaxed">
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>{m.text}</ReactMarkdown>
                  </div>
                )}
                {m.status && <p className="animate-pulse text-sm text-stone-500">{m.status}</p>}
                {m.error && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800 dark:bg-red-950 dark:text-red-200">{m.error}</p>}
                {m.cost !== undefined && <p className="text-[11px] text-stone-400">≈ {(m.cost * 79).toFixed(1)}p</p>}
              </div>
            )}
          </li>
        ))}
      </ol>
      <div ref={endRef} />

      <form onSubmit={(e) => { e.preventDefault(); send(input); }} className="flex items-end gap-2">
        <textarea value={input} onChange={(e) => setInput(e.target.value)} rows={2} placeholder={items.length ? "Ask a follow-up" : "Ask about your films"}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey && !("ontouchstart" in window)) { e.preventDefault(); send(input); } }}
          aria-label="Your question"
          className="min-w-0 flex-1 resize-none rounded-lg border border-stone-300 bg-white px-3 py-2 text-base sm:text-sm dark:border-stone-700 dark:bg-stone-900" />
        <button type="submit" disabled={busy || !input.trim()}
          className="shrink-0 rounded-lg bg-stone-900 px-4 py-2.5 text-sm font-medium text-white disabled:opacity-50 dark:bg-stone-100 dark:text-stone-900">
          {busy ? "…" : "Ask"}
        </button>
      </form>
    </div>
  );
}
