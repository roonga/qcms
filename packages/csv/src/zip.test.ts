/**
 * The streaming ZIP container (task 075).
 *
 * The archive is parsed back here by reading its own records rather than by
 * shelling out to `unzip`: this package has no dependencies and the thing under
 * test *is* the record layout, so a reader written against APPNOTE is the
 * assertion. One real-reader check is kept at the end - `node:zlib` is not
 * imported, but the archive's central directory and its data descriptors are
 * cross-checked against each other, which is what a reader does first.
 */

import { describe, expect, it } from "vitest";

import { zipStream, type ZipEntry } from "./zip.js";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

async function collect(stream: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  const reader = stream.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
  }
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const joined = new Uint8Array(total);
  let at = 0;
  for (const chunk of chunks) {
    joined.set(chunk, at);
    at += chunk.length;
  }
  return joined;
}

function text(name: string, body: string): ZipEntry {
  return { name, content: [encoder.encode(body)] };
}

/** Everything a reader takes from the end of the archive, read the way one does. */
interface Parsed {
  readonly entries: ReadonlyArray<{ name: string; crc: number; size: number; body: string }>;
}

function parse(bytes: Uint8Array): Parsed {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  // The end-of-central-directory record is the last 22 bytes (no comment).
  const end = bytes.length - 22;
  expect(view.getUint32(end, true)).toBe(0x06054b50);
  const count = view.getUint16(end + 10, true);
  const directorySize = view.getUint32(end + 12, true);
  const directoryOffset = view.getUint32(end + 16, true);
  expect(directoryOffset + directorySize).toBe(end);

  const entries: Array<{ name: string; crc: number; size: number; body: string }> = [];
  let at = directoryOffset;
  for (let index = 0; index < count; index += 1) {
    expect(view.getUint32(at, true)).toBe(0x02014b50);
    const crc = view.getUint32(at + 16, true);
    const compressed = view.getUint32(at + 20, true);
    const size = view.getUint32(at + 24, true);
    const nameLength = view.getUint16(at + 28, true);
    const localOffset = view.getUint32(at + 42, true);
    const name = decoder.decode(bytes.subarray(at + 46, at + 46 + nameLength));
    expect(compressed).toBe(size);

    // The local header the directory points at, and the data behind it.
    expect(view.getUint32(localOffset, true)).toBe(0x04034b50);
    expect(view.getUint16(localOffset + 6, true) & 0x0008).toBe(0x0008); // data descriptor
    expect(view.getUint16(localOffset + 8, true)).toBe(0); // stored
    // Sizes in a bit-3 local header are zero; the descriptor after the data holds them.
    expect(view.getUint32(localOffset + 14, true)).toBe(0);
    expect(view.getUint32(localOffset + 18, true)).toBe(0);
    expect(view.getUint32(localOffset + 22, true)).toBe(0);
    const localNameLength = view.getUint16(localOffset + 26, true);
    const dataAt = localOffset + 30 + localNameLength;
    const body = decoder.decode(bytes.subarray(dataAt, dataAt + size));
    // The data descriptor agrees with the central directory.
    expect(view.getUint32(dataAt + size, true)).toBe(0x08074b50);
    expect(view.getUint32(dataAt + size + 4, true)).toBe(crc);
    expect(view.getUint32(dataAt + size + 8, true)).toBe(size);

    entries.push({ name, crc, size, body });
    at += 46 + nameLength;
  }
  expect(at).toBe(end);
  return { entries };
}

describe("zipStream", () => {
  it("writes each entry's bytes, name and size, in order", async () => {
    const bytes = await collect(
      zipStream([text("responses.csv", "a,b\r\n1,2\r\n"), text("grp_passengers.csv", "x\r\n")]),
    );
    const { entries } = parse(bytes);
    expect(entries.map((e) => e.name)).toEqual(["responses.csv", "grp_passengers.csv"]);
    expect(entries[0]!.body).toBe("a,b\r\n1,2\r\n");
    expect(entries[1]!.body).toBe("x\r\n");
    expect(entries[0]!.size).toBe(10);
  });

  it("computes the CRC-32 the format specifies", async () => {
    // "123456789" has the well-known IEEE CRC-32 check value 0xCBF43926, which is
    // what pins this implementation against the standard rather than against itself.
    const bytes = await collect(zipStream([text("check.txt", "123456789")]));
    expect(parse(bytes).entries[0]!.crc).toBe(0xcbf4_3926);
  });

  it("joins an entry's chunks into one file", async () => {
    async function* chunked(): AsyncIterable<Uint8Array> {
      yield encoder.encode("one,");
      yield encoder.encode("two,");
      yield new Uint8Array(0); // an empty chunk contributes nothing
      yield encoder.encode("three");
    }
    const bytes = await collect(zipStream([{ name: "c.csv", content: chunked() }]));
    expect(parse(bytes).entries[0]!.body).toBe("one,two,three");
  });

  it("pulls each entry only when the previous one is written", async () => {
    // The property the memory bound rests on: the export makes each entry its own
    // pass over a keyset-paged query, so asking for entry two before entry one is
    // finished would mean two live cursors and two pages in memory.
    const order: string[] = [];
    async function* entries(): AsyncIterable<ZipEntry> {
      order.push("ask:1");
      yield {
        name: "1.csv",
        content: (function* () {
          order.push("write:1");
          yield encoder.encode("1");
        })(),
      };
      order.push("ask:2");
      yield {
        name: "2.csv",
        content: (function* () {
          order.push("write:2");
          yield encoder.encode("2");
        })(),
      };
    }
    await collect(zipStream(entries()));
    expect(order).toEqual(["ask:1", "write:1", "ask:2", "write:2"]);
  });

  it("is byte-deterministic: no clock reaches the archive", async () => {
    const first = await collect(zipStream([text("a.csv", "x")]));
    const second = await collect(zipStream([text("a.csv", "x")]));
    expect([...first]).toEqual([...second]);
  });

  it("writes UTF-8 names and says so in the flags", async () => {
    const bytes = await collect(zipStream([text("réponses.csv", "x")]));
    const view = new DataView(bytes.buffer);
    // Flag bit 11 announces a UTF-8 name, which is what keeps a non-ASCII entry
    // name readable rather than codepage-guessed.
    expect(view.getUint16(6, true) & 0x0800).toBe(0x0800);
    expect(parse(bytes).entries[0]!.name).toBe("réponses.csv");
  });

  it("produces a valid empty archive for no entries", async () => {
    const bytes = await collect(zipStream([]));
    expect(bytes.length).toBe(22);
    expect(parse(bytes).entries).toEqual([]);
  });

  it("accepts an empty file", async () => {
    const bytes = await collect(zipStream([text("empty.csv", "")]));
    const entry = parse(bytes).entries[0]!;
    expect(entry.size).toBe(0);
    expect(entry.crc).toBe(0);
  });
});
