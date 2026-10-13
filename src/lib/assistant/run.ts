import "server-only";
import type Anthropic from "@anthropic-ai/sdk";
import { AnthropicFoundry } from "@anthropic-ai/foundry-sdk";
import { createConversation, getConversation, saveMessage, spentTodayUsd, type StoredMessage } from "@/db/assistant";
import { systemPrompt } from "./prompt";
import { runTool, toolStatus, TOOLS } from "./tools";

export type AssistantEvent =
  | { type: "conversation"; id: string }
  | { type: "status"; text: string }
  | { type: "text"; delta: string }
  | { type: "done"; costUsd: number }
  | { type: "error"; message: string };

const MODEL = () => process.env.ASSISTANT_MODEL ?? "claude-sonnet-5-5";
const DAILY_LIMIT_USD = () => Number(process.env.ASSISTANT_DAILY_LIMIT_USD ?? "2");
const MAX_STEPS = 10;

/** Claude Sonnet 5.5 list prices (Azure bills Anthropic's prices), US dollars per token. */
const PRICE = { input: 2 / 1e6, output: 10 / 1e6, cacheWrite: 2.5 / 1e6, cacheRead: 0.2 / 1e6, webSearch: 10 / 1000 };

function costOf(u: Anthropic.Usage): number {
  return u.input_tokens * PRICE.input + u.output_tokens * PRICE.output
    + (u.cache_creation_input_tokens ?? 0) * PRICE.cacheWrite + (u.cache_read_input_tokens ?? 0) * PRICE.cacheRead
    + (u.server_tool_use?.web_search_requests ?? 0) * PRICE.webSearch;
}

let client: AnthropicFoundry | null = null;
const claude = () => (client ??= new AnthropicFoundry({ apiKey: process.env.FOUNDRY_API_KEY, resource: process.env.FOUNDRY_RESOURCE }));

/** Stored messages as an API conversation; consecutive same-role messages are merged (e.g. tool results then a new question). */
function toParams(stored: StoredMessage[]): Anthropic.MessageParam[] {
  const out: Anthropic.MessageParam[] = [];
  for (const m of stored) {
    const blocks = typeof m.content === "string" ? [{ type: "text" as const, text: m.content }] : m.content;
    const last = out.at(-1);
    if (last && last.role === m.role) last.content = [...(last.content as Anthropic.ContentBlockParam[]), ...(blocks as Anthropic.ContentBlockParam[])];
    else out.push({ role: m.role, content: [...(blocks as Anthropic.ContentBlockParam[])] });
  }
  return out;
}

/**
 * Answers one message in a conversation (a new one if conversationId is null),
 * calling tools as needed and streaming events to `emit`.
 */
export async function ask(conversationId: string | null, text: string, emit: (e: AssistantEvent) => void) {
  const spent = await spentTodayUsd();
  if (spent >= DAILY_LIMIT_USD()) {
    emit({ type: "error", message: `That's today's assistant budget used ($${spent.toFixed(2)} of $${DAILY_LIMIT_USD().toFixed(2)}). It resets at midnight.` });
    return;
  }

  const existing = conversationId ? await getConversation(conversationId) : null;
  const id = existing?.id ?? (await createConversation(text));
  emit({ type: "conversation", id });

  const history = (existing?.messages ?? []).map((m) => ({ role: m.role as StoredMessage["role"], content: m.content as StoredMessage["content"] }));
  const userMessage: StoredMessage = { role: "user", content: [{ type: "text", text }] };
  await saveMessage(id, userMessage);
  const messages = toParams([...history, userMessage]);
  const system: Anthropic.TextBlockParam[] = [{ type: "text", text: systemPrompt(), cache_control: { type: "ephemeral" } }];

  let cost = 0;
  let wroteText = false;
  try {
    for (let step = 0; step < MAX_STEPS; step++) {
      const stream = claude().messages.stream({
        model: MODEL(),
        max_tokens: 8000,
        system,
        tools: TOOLS,
        messages,
        output_config: { effort: "medium" },
        // Also cache the growing conversation, which is re-sent on every tool step.
        cache_control: { type: "ephemeral" },
      });
      let firstDelta = true;
      stream.on("text", (delta) => {
        if (firstDelta && wroteText) emit({ type: "text", delta: "\n\n" });
        firstDelta = false;
        wroteText = true;
        emit({ type: "text", delta });
      });
      stream.on("streamEvent", (ev) => {
        if (ev.type === "content_block_start" && (ev.content_block.type === "tool_use" || ev.content_block.type === "server_tool_use")) {
          emit({ type: "status", text: toolStatus(ev.content_block.name) });
        }
      });
      const msg = await stream.finalMessage();
      const msgCost = costOf(msg.usage);
      cost += msgCost;
      await saveMessage(id, { role: "assistant", content: msg.content as Anthropic.ContentBlockParam[] }, msg.usage, msgCost);
      messages.push({ role: "assistant", content: msg.content as Anthropic.ContentBlockParam[] });

      if (msg.stop_reason === "pause_turn") continue; // web search paused; carry on
      if (msg.stop_reason === "refusal") {
        emit({ type: "error", message: "Claude declined to answer that one." });
        break;
      }
      if (msg.stop_reason === "max_tokens") {
        emit({ type: "text", delta: "\n\n_(The answer was cut short.)_" });
        break;
      }
      const toolUses = msg.content.filter((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
      if (!toolUses.length) break;

      const results: Anthropic.ToolResultBlockParam[] = await Promise.all(
        toolUses.map(async (t) => ({ type: "tool_result" as const, tool_use_id: t.id, content: await runTool(t.name, t.input as Record<string, unknown>) })),
      );
      await saveMessage(id, { role: "user", content: results });
      messages.push({ role: "user", content: results });
      if (step === MAX_STEPS - 1) emit({ type: "text", delta: "\n\n_(Stopped after too many lookups. Try a narrower question.)_" });
    }
    emit({ type: "done", costUsd: cost });
  } catch (e) {
    console.error("assistant failed", e);
    emit({ type: "error", message: "Something went wrong talking to Claude. Try again in a moment." });
  }
}
