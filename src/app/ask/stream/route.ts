import { ask, type AssistantEvent } from "@/lib/assistant/run";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** POST { conversationId?, message } → a stream of newline-delimited JSON AssistantEvents. */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as { conversationId?: unknown; message?: unknown } | null;
  const message = typeof body?.message === "string" ? body.message.trim().slice(0, 4000) : "";
  const conversationId = typeof body?.conversationId === "string" && UUID.test(body.conversationId) ? body.conversationId : null;
  if (!message) return Response.json({ error: "Ask something." }, { status: 400 });

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const emit = (e: AssistantEvent) => controller.enqueue(encoder.encode(JSON.stringify(e) + "\n"));
      try {
        await ask(conversationId, message, emit);
      } finally {
        controller.close();
      }
    },
  });
  return new Response(stream, { headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store", "X-Accel-Buffering": "no" } });
}
