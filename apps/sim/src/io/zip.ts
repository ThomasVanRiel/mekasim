/** A file to put in a zip: its path in it, and its text. */
export interface Entry {
  path: string;
  text: string;
}

const CRC_TABLE = Uint32Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let bit = 0; bit < 8; bit++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of data) crc = (CRC_TABLE[(crc ^ byte) & 0xff] as number) ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

/** The first day a zip can date a file from, as it has no clock to ask. */
const DATE = (1 << 5) | 1;

/**
 * Files as one zip, stored as they are without compression: enough for the few
 * small files of a 3MF, and nothing to add to the project for it.
 */
export function zip(entries: Entry[]): ArrayBuffer {
  const encoder = new TextEncoder();
  const files = entries.map((entry) => {
    const data = encoder.encode(entry.text);
    return { name: encoder.encode(entry.path), data, crc: crc32(data) };
  });
  const names = files.reduce((sum, file) => sum + file.name.length, 0);
  const content = files.reduce((sum, file) => sum + file.data.length, 0);
  const directoryAt = 30 * files.length + names + content;
  const directorySize = 46 * files.length + names;
  const bytes = new Uint8Array(directoryAt + directorySize + 22);
  const view = new DataView(bytes.buffer);

  let at = 0;
  let listed = directoryAt;
  for (const file of files) {
    // What both the file's own header and its line in the directory say of it.
    const describe = (from: number) => {
      view.setUint16(from, 20, true); // the zip version needed to read it
      view.setUint16(from + 2, 1 << 11, true); // names are UTF-8
      view.setUint16(from + 4, 0, true); // stored
      view.setUint16(from + 6, 0, true);
      view.setUint16(from + 8, DATE, true);
      view.setUint32(from + 10, file.crc, true);
      view.setUint32(from + 14, file.data.length, true);
      view.setUint32(from + 18, file.data.length, true);
      view.setUint16(from + 22, file.name.length, true);
    };
    view.setUint32(listed, 0x02014b50, true);
    view.setUint16(listed + 4, 20, true);
    describe(listed + 6);
    view.setUint32(listed + 42, at, true);
    bytes.set(file.name, listed + 46);
    listed += 46 + file.name.length;

    view.setUint32(at, 0x04034b50, true);
    describe(at + 4);
    bytes.set(file.name, at + 30);
    bytes.set(file.data, at + 30 + file.name.length);
    at += 30 + file.name.length + file.data.length;
  }

  view.setUint32(listed, 0x06054b50, true);
  view.setUint16(listed + 8, files.length, true);
  view.setUint16(listed + 10, files.length, true);
  view.setUint32(listed + 12, directorySize, true);
  view.setUint32(listed + 16, directoryAt, true);
  return bytes.buffer;
}
