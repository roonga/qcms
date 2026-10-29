/**
 * A streaming, fetch-pure (R4) ZIP container. Entries are stored with flag bit 3 and a
 * trailing data descriptor (APPNOTE 4.3.9), with a fixed timestamp so output is
 * reproducible. Non-ZIP64: exceeding 4 GiB or 65,535 entries errors.
 */

const encoder = new TextEncoder();

const LOCAL_HEADER_SIGNATURE = 0x04034b50;
const DATA_DESCRIPTOR_SIGNATURE = 0x08074b50;
const CENTRAL_HEADER_SIGNATURE = 0x02014b50;
const END_OF_CENTRAL_DIRECTORY_SIGNATURE = 0x06054b50;

/** Stored entries with a data descriptor need nothing newer than 2.0. */
const VERSION_NEEDED = 20;
/** Bit 3: sizes follow in a data descriptor. Bit 11: the name is UTF-8. */
const FLAGS = 0x0008 | 0x0800;
const METHOD_STORED = 0;
/** DOS epoch, so an archive is a function of its data alone. */
const DOS_TIME = 0;
const DOS_DATE = 0x0021;

const UINT32_MAX = 0xffff_ffff;
const UINT16_MAX = 0xffff;

export interface ZipEntry {
  /** The path inside the archive: forward slashes, UTF-8. */
  readonly name: string;
  /** An empty iterable is an empty file. */
  readonly content: AsyncIterable<Uint8Array> | Iterable<Uint8Array>;
}

/** What the central directory remembers about an entry already written. */
interface WrittenEntry {
  readonly name: Uint8Array;
  readonly crc: number;
  readonly size: number;
  readonly offset: number;
}

/**
 * The CRC-32 table (IEEE 802.3 polynomial, reflected), built on first use so a
 * process that only serializes CSV fields never builds it.
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

/** Carries the running value pre-inverted; {@link crcFinish} inverts it once. */
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
function record(size: number): {
  bytes: Uint8Array;
  u16: (v: number) => void;
  u32: (v: number) => void;
} {
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

/** Names the limit and the way past it. */
function tooLarge(what: string): Error {
  return new Error(
    `zipStream: ${what} exceeds this archive format's 4 GiB limit; ZIP64 headers are not written`,
  );
}

interface OpenEntry {
  readonly name: Uint8Array;
  readonly label: string;
  readonly offset: number;
  readonly content: AsyncIterator<Uint8Array> | Iterator<Uint8Array>;
  /** The running CRC-32, carried pre-inverted (see {@link crcUpdate}). */
  crc: number;
  size: number;
}

/**
 * A ZIP archive of `entries`, as a web `ReadableStream`. One unit of work per `pull` is the
 * memory bound, and entries are consumed lazily and in order, the next asked for only once
 * the previous is closed.
 */
export function zipStream(
  entries: AsyncIterable<ZipEntry> | Iterable<ZipEntry>,
): ReadableStream<Uint8Array> {
  const source = Symbol.asyncIterator in entries ? entries[Symbol.asyncIterator]() : null;
  const sync = source === null ? (entries as Iterable<ZipEntry>)[Symbol.iterator]() : null;
  const written: WrittenEntry[] = [];
  let offset = 0;
  let open: OpenEntry | undefined;
  let finished = false;

  async function nextEntry(): Promise<ZipEntry | undefined> {
    const result = source === null ? sync!.next() : await source.next();
    return result.done === true ? undefined : result.value;
  }

  /** Whichever iteration protocol the entry offers. */
  function contentIterator(entry: ZipEntry): AsyncIterator<Uint8Array> | Iterator<Uint8Array> {
    const content = entry.content;
    return Symbol.asyncIterator in content
      ? content[Symbol.asyncIterator]()
      : content[Symbol.iterator]();
  }

  async function openNext(controller: ReadableStreamDefaultController<Uint8Array>): Promise<void> {
    const entry = await nextEntry();
    if (entry === undefined) {
      controller.enqueue(centralDirectory(written, offset));
      controller.close();
      finished = true;
      return;
    }
    const name = encoder.encode(entry.name);
    const header = localHeader(name);
    open = {
      name,
      label: entry.name,
      offset,
      content: contentIterator(entry),
      crc: 0xffff_ffff,
      size: 0,
    };
    controller.enqueue(header);
    offset += header.length;
  }

  function closeOpen(
    controller: ReadableStreamDefaultController<Uint8Array>,
    entry: OpenEntry,
  ): void {
    const crc = crcFinish(entry.crc);
    const descriptor = dataDescriptor(crc, entry.size);
    controller.enqueue(descriptor);
    offset += descriptor.length;
    if (offset > UINT32_MAX) throw tooLarge("the archive");
    if (written.length >= UINT16_MAX) {
      throw new Error("zipStream: an archive may hold at most 65,535 entries");
    }
    written.push({ name: entry.name, crc, size: entry.size, offset: entry.offset });
    open = undefined;
  }

  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (finished) return;
      const entry = open;
      if (entry === undefined) {
        await openNext(controller);
        return;
      }
      // An empty chunk is skipped inside this call rather than returned: a
      // `pull` that enqueues nothing is not called again, so the stream would
      // stall with a read outstanding.
      for (;;) {
        const step = await entry.content.next();
        if (step.done === true) {
          closeOpen(controller, entry);
          return;
        }
        const chunk = step.value;
        if (chunk.length === 0) continue;
        entry.crc = crcUpdate(entry.crc, chunk);
        entry.size += chunk.length;
        if (entry.size > UINT32_MAX) throw tooLarge(`entry "${entry.label}"`);
        offset += chunk.length;
        controller.enqueue(chunk);
        return;
      }
    },
  });
}

/** One final chunk, so the archive ends in a single enqueue. */
function centralDirectory(written: readonly WrittenEntry[], offset: number): Uint8Array {
  let directory: Uint8Array = new Uint8Array(0);
  for (const entry of written) directory = concat(directory, centralHeader(entry));
  if (offset + directory.length > UINT32_MAX) throw tooLarge("the archive");
  return concat(directory, endOfCentralDirectory(written.length, directory.length, offset));
}
