import { readFile } from "node:fs/promises";
import path from "node:path";

/** The background photos there are. Anything else is a 404, so this can't be used to read other blobs. */
const NAMES = new Set(["cinema-vert.webp", "cinema-horiz.webp"]);

/**
 * Serves a background photo from the private `spinefindmedia/backgrounds` container, fetched with the
 * container app's managed identity (it has Storage Blob Data Reader). The route sits behind Easy Auth
 * like the rest of the app, so only you see the photos. Locally (no MEDIA_ACCOUNT) it reads images/web/.
 */
export async function GET(_req: Request, { params }: RouteContext<"/media/backgrounds/[name]">) {
  const { name } = await params;
  if (!NAMES.has(name)) return new Response("Not found", { status: 404 });
  try {
    const body = await photo(name);
    return new Response(new Uint8Array(body), {
      headers: { "content-type": "image/webp", "cache-control": "private, max-age=604800" },
    });
  } catch (e) {
    console.error("background photo", name, e);
    return new Response("Unavailable", { status: 502 });
  }
}

const cache = new Map<string, Buffer>();
let token: { value: string; expires: number } | null = null;

async function photo(name: string): Promise<Buffer> {
  const hit = cache.get(name);
  if (hit) return hit;
  const account = process.env.MEDIA_ACCOUNT;
  let body: Buffer;
  if (!account) {
    body = await readFile(path.join(process.cwd(), "images", "web", name));
  } else {
    const container = process.env.MEDIA_CONTAINER ?? "backgrounds";
    const res = await fetch(`https://${account}.blob.core.windows.net/${container}/${name}`, {
      headers: { authorization: `Bearer ${await storageToken()}`, "x-ms-version": "2023-11-03" },
    });
    if (!res.ok) throw new Error(`blob ${res.status}`);
    body = Buffer.from(await res.arrayBuffer());
  }
  cache.set(name, body);
  return body;
}

/** A storage token from the Container Apps managed identity endpoint, reused until near expiry. */
async function storageToken(): Promise<string> {
  if (token && token.expires - Date.now() > 5 * 60_000) return token.value;
  const endpoint = process.env.IDENTITY_ENDPOINT, header = process.env.IDENTITY_HEADER;
  if (!endpoint || !header) throw new Error("no managed identity");
  const res = await fetch(`${endpoint}?resource=${encodeURIComponent("https://storage.azure.com/")}&api-version=2019-08-01`, {
    headers: { "x-identity-header": header },
  });
  if (!res.ok) throw new Error(`identity ${res.status}`);
  const j = (await res.json()) as { access_token: string; expires_on: string | number };
  token = { value: j.access_token, expires: Number(j.expires_on) * 1000 };
  return token.value;
}
