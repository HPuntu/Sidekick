import { inflateSync } from "zlib";

export interface PdfTextExtractionResult {
  pageLikeBlocks: number;
  text: string;
  warning?: string;
}

const MAX_STREAMS = 150;
const MAX_COMPRESSED_STREAM_BYTES = 2 * 1024 * 1024;
const MAX_DECODED_STREAM_BYTES = 4 * 1024 * 1024;
const MAX_TOTAL_DECODED_BYTES = 8 * 1024 * 1024;

export function extractPdfText(
  data: ArrayBuffer,
  maxChars: number
): PdfTextExtractionResult {
  const bytes = Buffer.from(data);
  const source = bytes.toString("latin1");
  const chunks: string[] = [];
  let streamCount = 0;
  let decodedByteCount = 0;

  for (const match of source.matchAll(/<<(?:.|\r|\n){0,4000}?>>\s*stream\r?\n?([\s\S]*?)\r?\n?endstream/g)) {
    if (streamCount >= MAX_STREAMS || getTextLength(chunks) >= maxChars) {
      break;
    }

    streamCount += 1;
    const dictionary = match[0].slice(0, match[0].indexOf("stream"));
    const streamBytes = Buffer.from(match[1], "latin1");
    const remainingDecodedBytes = MAX_TOTAL_DECODED_BYTES - decodedByteCount;
    if (remainingDecodedBytes <= 0) {
      break;
    }

    const decoded = decodePdfStream(dictionary, streamBytes, remainingDecodedBytes);
    if (!decoded) {
      continue;
    }

    decodedByteCount += decoded.length;
    const text = extractTextFromContentStream(decoded.toString("latin1"));
    if (text) {
      chunks.push(text);
    }
  }

  if (chunks.length === 0) {
    const fallbackText = extractTextFromContentStream(source.slice(0, MAX_TOTAL_DECODED_BYTES));
    if (fallbackText) {
      chunks.push(fallbackText);
    }
  }

  const text = normalizePdfText(chunks.join("\n\n")).slice(0, maxChars);
  if (!text) {
    return {
      pageLikeBlocks: 0,
      text: "",
      warning:
        "No selectable PDF text was extracted. The PDF may be scanned, encrypted, image-only, or use an unsupported encoding."
    };
  }

  return {
    pageLikeBlocks: chunks.length,
    text,
    warning:
      text.length >= maxChars
        ? `PDF text was truncated to ${maxChars.toLocaleString()} characters.`
        : undefined
  };
}

function decodePdfStream(
  dictionary: string,
  streamBytes: Buffer,
  remainingDecodedBytes: number
): Buffer | undefined {
  if (streamBytes.length > MAX_COMPRESSED_STREAM_BYTES) {
    return undefined;
  }

  const maxOutputLength = Math.min(
    MAX_DECODED_STREAM_BYTES,
    remainingDecodedBytes
  );

  if (/\/FlateDecode\b/.test(dictionary)) {
    try {
      return inflateSync(trimStreamLineEndings(streamBytes), { maxOutputLength });
    } catch {
      return undefined;
    }
  }

  if (/\/Filter\b/.test(dictionary)) {
    return undefined;
  }

  const trimmed = trimStreamLineEndings(streamBytes);
  if (trimmed.length > maxOutputLength) {
    return undefined;
  }

  return trimmed;
}

function trimStreamLineEndings(value: Buffer): Buffer {
  let start = 0;
  let end = value.length;

  if (value[start] === 0x0d && value[start + 1] === 0x0a) {
    start += 2;
  } else if (value[start] === 0x0a || value[start] === 0x0d) {
    start += 1;
  }

  if (value[end - 2] === 0x0d && value[end - 1] === 0x0a) {
    end -= 2;
  } else if (value[end - 1] === 0x0a || value[end - 1] === 0x0d) {
    end -= 1;
  }

  return value.subarray(start, end);
}

function extractTextFromContentStream(value: string): string {
  const blocks: string[] = [];
  for (const match of value.matchAll(/\bBT\b([\s\S]*?)\bET\b/g)) {
    const blockText = extractPdfStrings(match[1]);
    if (blockText) {
      blocks.push(blockText);
    }
  }

  return blocks.join("\n");
}

// In a TJ array, a number after a string adjusts the next glyph position
// (thousandths of an em, subtracted from the x position). A sufficiently
// negative value shifts the following text right — i.e. a word space. LaTeX
// PDFs encode inter-word spaces this way, so without it every word runs together.
const TJ_SPACE_THRESHOLD = 100;

function extractPdfStrings(value: string): string {
  const parts: string[] = [];
  let index = 0;

  while (index < value.length) {
    const char = value[index];
    if (char === "(") {
      const parsed = readLiteralString(value, index);
      if (parsed) {
        parts.push(parsed.text);
        index = consumeTjAdjustment(value, parsed.end, parts);
        continue;
      }
    }

    if (char === "<" && value[index + 1] !== "<") {
      const parsed = readHexString(value, index);
      if (parsed) {
        parts.push(parsed.text);
        index = consumeTjAdjustment(value, parsed.end, parts);
        continue;
      }
    }

    if (isTextLineOperatorAt(value, index)) {
      parts.push("\n");
      index += 2;
      continue;
    }

    index += 1;
  }

  return parts.join("");
}

function consumeTjAdjustment(
  value: string,
  index: number,
  parts: string[]
): number {
  let cursor = index;
  while (cursor < value.length && /\s/.test(value[cursor])) {
    cursor += 1;
  }

  const match = value.slice(cursor, cursor + 24).match(/^-?\d+(?:\.\d+)?/);
  if (!match) {
    return index;
  }

  if (Number.parseFloat(match[0]) <= -TJ_SPACE_THRESHOLD) {
    parts.push(" ");
  }

  return cursor + match[0].length;
}

function readLiteralString(
  value: string,
  start: number
): { end: number; text: string } | undefined {
  let depth = 0;
  let output = "";

  for (let index = start; index < value.length; index += 1) {
    const char = value[index];
    if (index === start) {
      depth = 1;
      continue;
    }

    if (char === "\\") {
      const escaped = readEscapedPdfChar(value, index);
      output += escaped.text;
      index = escaped.end - 1;
      continue;
    }

    if (char === "(") {
      depth += 1;
      output += char;
      continue;
    }

    if (char === ")") {
      depth -= 1;
      if (depth === 0) {
        return {
          end: index + 1,
          text: decodePdfText(output)
        };
      }

      output += char;
      continue;
    }

    output += char;
  }

  return undefined;
}

function readEscapedPdfChar(value: string, slashIndex: number): { end: number; text: string } {
  const next = value[slashIndex + 1] ?? "";
  if (/[0-7]/.test(next)) {
    const octal = value.slice(slashIndex + 1, slashIndex + 4).match(/^[0-7]{1,3}/)?.[0] ?? "";
    return {
      end: slashIndex + 1 + octal.length,
      text: String.fromCharCode(Number.parseInt(octal, 8))
    };
  }

  const escaped: Record<string, string> = {
    b: "\b",
    f: "\f",
    n: "\n",
    r: "\r",
    t: "\t"
  };

  if (next === "\n") {
    return { end: slashIndex + 2, text: "" };
  }

  if (next === "\r" && value[slashIndex + 2] === "\n") {
    return { end: slashIndex + 3, text: "" };
  }

  return {
    end: slashIndex + 2,
    text: escaped[next] ?? next
  };
}

function readHexString(
  value: string,
  start: number
): { end: number; text: string } | undefined {
  const end = value.indexOf(">", start + 1);
  if (end === -1) {
    return undefined;
  }

  const hex = value.slice(start + 1, end).replace(/\s+/g, "");
  if (!hex || !/^[0-9a-f]*$/i.test(hex)) {
    return undefined;
  }

  const normalizedHex = hex.length % 2 === 0 ? hex : `${hex}0`;
  const bytes = Buffer.from(normalizedHex, "hex");
  return {
    end: end + 1,
    text: decodePdfText(bytes.toString("latin1"))
  };
}

function decodePdfText(value: string): string {
  const bytes = Buffer.from(value, "latin1");
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    const chars: string[] = [];
    for (let index = 2; index + 1 < bytes.length; index += 2) {
      chars.push(String.fromCharCode((bytes[index] << 8) | bytes[index + 1]));
    }
    return chars.join("");
  }

  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
    const chars: string[] = [];
    for (let index = 2; index + 1 < bytes.length; index += 2) {
      chars.push(String.fromCharCode(bytes[index] | (bytes[index + 1] << 8)));
    }
    return chars.join("");
  }

  return value;
}

function isTextLineOperatorAt(value: string, index: number): boolean {
  const operator = value.slice(index, index + 2);
  if (operator !== "Td" && operator !== "TD" && operator !== "T*") {
    return false;
  }

  const before = value[index - 1] ?? " ";
  const after = value[index + 2] ?? " ";
  return /\s/.test(before) && /\s/.test(after);
}

function normalizePdfText(value: string): string {
  return value
    .replace(/\0/g, "")
    .replace(/[ \t\f\v]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function getTextLength(values: string[]): number {
  return values.reduce((total, value) => total + value.length, 0);
}
