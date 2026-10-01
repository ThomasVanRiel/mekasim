/** A model packed into the part of a link after `#`, which browsers never send to a server. */
const PREFIX = "#m=";

async function pipe(
  bytes: Uint8Array,
  stream: CompressionStream | DecompressionStream,
): Promise<Uint8Array> {
  const piped = new Blob([bytes as BlobPart]).stream().pipeThrough(stream);
  return new Uint8Array(await new Response(piped).arrayBuffer());
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

function fromBase64Url(text: string): Uint8Array {
  const binary = atob(text.replaceAll("-", "+").replaceAll("_", "/"));
  return Uint8Array.from(binary, (ch) => ch.charCodeAt(0));
}

/** The fragment that carries a model, starting with `#`. */
export async function encodeModel(text: string): Promise<string> {
  const packed = await pipe(new TextEncoder().encode(text), new CompressionStream("deflate-raw"));
  return PREFIX + toBase64Url(packed);
}

/** The model carried by a fragment, or undefined when the fragment carries none or is damaged. */
export async function decodeModel(fragment: string): Promise<string | undefined> {
  if (!fragment.startsWith(PREFIX)) return undefined;
  try {
    const packed = fromBase64Url(fragment.slice(PREFIX.length));
    const bytes = await pipe(packed, new DecompressionStream("deflate-raw"));
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return undefined;
  }
}
