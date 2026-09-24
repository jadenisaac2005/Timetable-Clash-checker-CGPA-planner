/**
 * Minimal ZIP reader for .docx (Office Open XML) files: central directory lookup + raw-deflate
 * via the platform DecompressionStream (all current browsers, Node ≥ 18). No dependency.
 */
export class ZipError extends Error {}

function u16(b: Uint8Array, o: number) {
  return b[o] | (b[o + 1] << 8);
}
function u32(b: Uint8Array, o: number) {
  return (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;
}

async function inflateRaw(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export async function readZipEntry(buf: ArrayBuffer | Uint8Array, name: string): Promise<Uint8Array | null> {
  const b = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  // End of central directory record: signature 0x06054b50, within the last 64 KiB + 22 bytes.
  let eocd = -1;
  for (let i = b.length - 22; i >= Math.max(0, b.length - 65557); i--)
    if (u32(b, i) === 0x06054b50) {
      eocd = i;
      break;
    }
  if (eocd < 0) throw new ZipError('Not a ZIP/Office file (no end-of-central-directory record)');
  const count = u16(b, eocd + 10);
  let p = u32(b, eocd + 16);
  const dec = new TextDecoder();
  for (let n = 0; n < count; n++) {
    if (u32(b, p) !== 0x02014b50) throw new ZipError('Corrupt ZIP central directory');
    const method = u16(b, p + 10);
    const compSize = u32(b, p + 20);
    const nameLen = u16(b, p + 28);
    const extraLen = u16(b, p + 30);
    const commentLen = u16(b, p + 32);
    const local = u32(b, p + 42);
    const entryName = dec.decode(b.subarray(p + 46, p + 46 + nameLen));
    if (entryName === name) {
      if (u32(b, local) !== 0x04034b50) throw new ZipError('Corrupt ZIP local header');
      const start = local + 30 + u16(b, local + 26) + u16(b, local + 28);
      const data = b.subarray(start, start + compSize);
      if (method === 0) return data;
      if (method === 8) return inflateRaw(data);
      throw new ZipError(`Unsupported ZIP compression method ${method}`);
    }
    p += 46 + nameLen + extraLen + commentLen;
  }
  return null;
}
