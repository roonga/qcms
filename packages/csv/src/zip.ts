/**
 * A streaming ZIP container for multi-file exports (task 075, ADR-42).
 *
 * The long CSV shape ruled for repeating groups (Q17, Code Owner, 2026-09-29) is
 * more than one file: `responses.csv` for every question outside a group, plus one
 * file per group at the group's own grain. A form with at least one group
 * therefore downloads as a **zip of those files**, and a form with none downloads
 * exactly the single file it always did, so no existing pipeline moves.
 *
 * ## Why this is here and not a dependency
 *
 * It is forty lines of record layout and a CRC table, it has to be **fetch-pure**
 * (R4: no `node:zlib`, no `node:stream`), and it has to **stream**, because the
 * response export is memory-bounded by contract - it keyset-pages the reporting
 * view and never holds the table. A library that takes a buffer would undo that
 * property for exactly the forms that need the zip most.
 *
 * It lives in `@roonga/qcms-csv` beside {@link csvField} for the reason that module
 * exists: the export's byte-level encoding is one thing in one place, so the API's
 * response export and the admin's link export cannot grow a second copy.
 *
 * ## Stored, never deflated
 *
 * Every entry is written with method 0 (stored). Compression would mean a second
 * encoder, a second failure mode mid-stream and a `CompressionStream` whose output
 * size is unknown until it ends. CSV compresses well and the operator is
 * downloading over HTTP, where `Content-Encoding: gzip` is the transport's job
 * rather than the container's. A stored zip is a valid zip to every reader.
 *
 * ## Data descriptors, which is what makes it streamable
 *
 * A local file header has to carry a CRC and two sizes, and none of the three is
 * known until the entry's last byte. So each entry sets general-purpose flag bit 3
 * and writes zeroes there, then writes a **data descriptor** after the data with
 * the real values; the central directory at the end carries them too. This is the
 * standard streaming-writer shape (APPNOTE 4.3.9) and it is why nothing is
 * buffered beyond one chunk.
 *
 * ## Determinism
 *
 * Every entry takes the same fixed DOS timestamp (1980-01-01 00:00), so two zips
 * of the same data are byte-identical and a golden test can assert bytes rather
 * than "a zip containing roughly this". The clock is deliberately not consulted.
 *
 * ## The one bound, stated rather than discovered
 *
 * This writer emits a **plain, non-ZIP64 archive**, so no single entry and no
 * archive may reach 4 GiB (0xFFFFFFFF bytes), and an archive may hold at most
 * 65,535 entries. A CSV export of that size is far beyond anything the response
 * export produces today - the whole reporting table for a large deployment is
 * megabytes - but the limit is real, so it is **checked** rather than assumed: a
 * stream that would exceed it errors with a message naming the limit instead of
 * emitting a truncated archive a reader would silently misparse. Lifting it means
 * ZIP64 headers, which is a change to this module and to nothing else.
 */

/** Names are written UTF-8, which is what flag bit 11 announces. */
const encoder = new TextEncoder();

const LOCAL_HEADER_SIGNATURE = 0x04034b50;
const DATA_DESCRIPTOR_SIGNATURE = 0x08074b50;
const CENTRAL_HEADER_SIGNATURE = 0x02014b50;
const END_OF_CENTRAL_DIRECTORY_SIGNATURE = 0x06054b50;

/** Version 2.0: stored entries with a data descriptor need nothing newer. */
const VERSION_NEEDED = 20;
/** Bit 3 = sizes follow in a data descriptor; bit 11 = the name is UTF-8. */
const FLAGS = 0x0008 | 0x0800;
/** Method 0 = stored. */
const METHOD_STORED = 0;
/** 1980-01-01 00:00 in DOS form, so an archive is a function of its data alone. */
const DOS_TIME = 0;
const DOS_DATE = 0x0021;

/** The 32-bit ceiling every size, offset and count in a non-ZIP64 archive sits under. */
const UINT32_MAX = 0xffff_ffff;
/** The 16-bit ceiling the entry count sits under. */
const UINT16_MAX = 0xffff;

/** One file in the archive: its name, and its bytes as they are produced. */
export interface ZipEntry {
  /** The path inside the archive, forward slashes, UTF-8. */
  readonly name: string;
  /** The entry's bytes, streamed. An empty iterable is an empty file. */
  readonly content: AsyncIterable<Uint8Array> | Iterable<Uint8Array>;
}

/** What the central directory needs to remember about an entry already written. */
interface WrittenEntry {
  readonly name: Uint8Array;
  readonly crc: number;
  readonly size: number;
  readonly offset: number;
}

/**
 * The CRC-32 table (IEEE 802.3 polynomial, reflected), built once on first use.
 *
 * Lazy rather than module-level so importing this module for its types costs
 * nothing, and `let` rather than a top-level computation so the 256-entry build
 * never runs in a process that only serializes CSV fields.
 */
let crcTable: Uint32Array | undefined;

function table(): Uint32Array {
  if (crcTable !== undefined) return crcTable;
  const built = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = (value & 1) === 1 ? 0xedb8_8320 ^ (value >>> 1) : value >>> 1;
    }
    built[index] = value >>> 0;
  }
  crcTable = built;
  return built;
}

/**
 * Fold a chunk into a running CRC-32.
 *
 * The running value is carried **pre-inverted** (`crc` starts at `0xffffffff` and
 * is inverted once at the end), which is the usual shape and the reason
 * {@link crcFinish} exists rather than this returning the final value.
 */
function crcUpdate(crc: number, chunk: Uint8Array): number {
  const lookup = table();
  let value = crc;
  for (const byte of chunk) {
    value = lookup[(value ^ byte) & 0xff]! ^ (value >>> 8);
  }
  return value >>> 0;
}

function crcFinish(crc: number): number {
  return (crc ^ 0xffff_ffff) >>> 0;
}

/** A little-endian writer over a fixed-size record. */
function record(size: number): { bytes: Uint8Array; u16: (v: number) => void; u32: (v: number) => void } {
  const bytes = new Uint8Array(size);
  const view = new DataView(bytes.buffer);
  let at = 0;
  return {
    bytes,
    u16: (value: number) => {
      view.setUint16(at, value, true);
      at += 2;
    },
    u32: (value: number) => {
      view.setUint32(at, value >>> 0, true);
      at += 4;
    },
  };
}

function localHeader(name: Uint8Array): Uint8Array {
  const head = record(30);
  head.u32(LOCAL_HEADER_SIGNATURE);
  head.u16(VERSION_NEEDED);
  head.u16(FLAGS);
  head.u16(METHOD_STORED);
  head.u16(DOS_TIME);
  head.u16(DOS_DATE);
  head.u32(0); // crc-32, in the data descriptor
  head.u32(0); // compressed size, in the data descriptor
  head.u32(0); // uncompressed size, in the data descriptor
  head.u16(name.length);
  head.u16(0); // extra field length
  return concat(head.bytes, name);
}

function dataDescriptor(crc: number, size: number): Uint8Array {
  const tail = record(16);
  tail.u32(DATA_DESCRIPTOR_SIGNATURE);
  tail.u32(crc);
  tail.u32(size); // compressed, which for a stored entry is the same number
  tail.u32(size); // uncompressed
  return tail.bytes;
}

function centralHeader(entry: WrittenEntry): Uint8Array {
  const head = record(46);
  head.u32(CENTRAL_HEADER_SIGNATURE);
  head.u16(VERSION_NEEDED); // version made by
  head.u16(VERSION_NEEDED);
  head.u16(FLAGS);
  head.u16(METHOD_STORED);
  head.u16(DOS_TIME);
  head.u16(DOS_DATE);
  head.u32(entry.crc);
  head.u32(entry.size);
  head.u32(entry.size);
  head.u16(entry.name.length);
  head.u16(0); // extra field length
  head.u16(0); // file comment length
  head.u16(0); // disk number start
  head.u16(0); // internal file attributes
  head.u32(0); // external file attributes
  head.u32(entry.offset);
  return concat(head.bytes, entry.name);
}

function endOfCentralDirectory(count: number, size: number, offset: number): Uint8Array {
  const end = record(22);
  end.u32(END_OF_CENTRAL_DIRECTORY_SIGNATURE);
  end.u16(0); // this disk
  end.u16(0); // disk with the central directory
  end.u16(count);
  end.u16(count);
  end.u32(size);
  end.u32(offset);
  end.u16(0); // comment length
  return end.bytes;
}

function concat(left: Uint8Array, right: Uint8Array): Uint8Array {
  const joined = new Uint8Array(left.length + right.length);
  joined.set(left, 0);
  joined.set(right, left.length);
  return joined;
}

/** The refusal both 32-bit ceilings raise, naming the limit and the way past it. */
function tooLarge(what: string): Error {
  return new Error(
    `zipStream: ${what} exceeds this archive format's 4 GiB limit; ZIP64 headers are not written`,
  );
}

/**
 * A ZIP archive of `entries`, as a web `ReadableStream` of bytes.
 *
 * The entries are consumed **in order and lazily**: the next entry's content is
 * only asked for once the previous one has been written, which is what lets the
 * caller make each entry its own pass over a keyset-paged query without ever
 * holding two of them.
 */
export function zipStream(
  entries: AsyncIterable<ZipEntry> | Iterable<ZipEntry>,
): ReadableStream<Uint8Array> {
  const source = Symbol.asyncIterator in entries ? entries[Symbol.asyncIterator]() : null;
  const sync = source === null ? (entries as Iterable<ZipEntry>)[Symbol.iterator]() : null;
  const written: WrittenEntry[] = [];
  let offset = 0;
  let finished = false;

  async function nextEntry(): Promise<ZipEntry | undefined> {
    const result = source === null ? sync!.next() : await source.next();
    return result.done === true ? undefined : result.value;
  }

  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (finished) return;
      const entry = await nextEntry();
      if (entry === undefined) {
        controller.enqueue(centralDirectory(written, offset));
        controller.close();
        finished = true;
        return;
      }
      // One entry per `pull`, which bounds the chunk the stream hands downstream
      // to this entry's own content chunks plus two small records.
      const name = encoder.encode(entry.name);
      const start = offset;
      const header = localHeader(name);
      controller.enqueue(header);
      offset += header.length;

      let crc = 0xffff_ffff;
      let size = 0;
      for await (const chunk of entry.content) {
        if (chunk.length === 0) continue;
        crc = crcUpdate(crc, chunk);
        size += chunk.length;
        if (size > UINT32_MAX) throw tooLarge(`entry "${entry.name}"`);
        controller.enqueue(chunk);
      }
      offset += size;
      const finalCrc = crcFinish(crc);
      const descriptor = dataDescriptor(finalCrc, size);
      controller.enqueue(descriptor);
      offset += descriptor.length;
      if (offset > UINT32_MAX) throw tooLarge("the archive");
      if (written.length >= UINT16_MAX) {
        throw new Error("zipStream: an archive may hold at most 65,535 entries");
      }
      written.push({ name, crc: finalCrc, size, offset: start });
    },
  });
}

/** The central directory and the end record, as one final chunk. */
function centralDirectory(written: readonly WrittenEntry[], offset: number): Uint8Array {
  let directory: Uint8Array = new Uint8Array(0);
  for (const entry of written) directory = concat(directory, centralHeader(entry));
  if (offset + directory.length > UINT32_MAX) throw tooLarge("the archive");
  return concat(directory, endOfCentralDirectory(written.length, directory.length, offset));
}
