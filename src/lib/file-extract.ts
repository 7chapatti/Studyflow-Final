// Real file-content extraction for uploaded assignment briefs.
//
// Previously every non-text file (PDF, DOCX, PPTX, images) went through
// `file.text()` -- decoding raw binary bytes as if they were UTF-8 text --
// then got discarded by a "is this mostly printable characters?" heuristic,
// since binary formats naturally fail that check. In practice that meant
// PDF/DOCX/PPTX/image uploads were silently treated as unreadable almost
// all the time, even though the UI (and the storage bucket's allowed MIME
// types) advertise support for them. This module actually parses each
// format instead of guessing at its bytes.
import JSZip from "jszip";
import mammoth from "mammoth";
import { redactPersonalInfo } from "@/lib/redact";
// pdf-parse's top-level index.js runs a debug/self-test harness on import
// in some non-`require.main` contexts, which has caused issues when bundled
// into serverless functions. Importing the library file directly (a
// well-known workaround for this package) skips that harness entirely.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const pdfParse = require("pdf-parse/lib/pdf-parse.js");

export interface ExtractedFile {
  name: string;
  text: string;
  note?: string;
  /** Set only for image uploads -- a data: URL suitable for a vision-capable
   * chat completion's `image_url` content part. Images are never converted
   * to text; the model reads them directly. */
  imageDataUrl?: string;
}

const PDF_MIME = "application/pdf";
const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const PPTX_MIME = "application/vnd.openxmlformats-officedocument.presentationml.presentation";

function stripHtml(input: string): string {
  return input.replace(/<[^>]*>/g, "");
}

function compressWhitespace(input: string): string {
  return input.replace(/\s+/g, " ").trim();
}

function printableRatio(input: string): number {
  if (!input) return 0;
  // \uFFFD (the Unicode replacement character) is what invalid byte
  // sequences decode to -- it's exactly what you get when binary content
  // (a legacy .doc/.ppt, a misidentified PDF, random bytes) is force-read
  // as UTF-8 text. It falls inside \u00A0-\uFFFF, so without excluding it
  // explicitly this heuristic counts "couldn't decode this byte" as
  // printable, which defeats the entire point of the check -- confirmed by
  // actually running binary content through it: a real .doc file's OLE2
  // header decoded to a string of (mostly) \uFFFD characters and still
  // scored ~1.0 "printable", so it sailed through as if it were real text.
  const printable = input.replace(/[^\x09\x0A\x0D\x20-\x7E\u00A0-\uFFFE]/g, "");
  return printable.length / input.length;
}

function extensionOf(name: string): string {
  const match = /\.([a-z0-9]+)$/i.exec(name);
  return match ? match[1].toLowerCase() : "";
}

async function extractPdfText(buffer: Buffer): Promise<string> {
  const result = await pdfParse(buffer);
  return typeof result?.text === "string" ? result.text : "";
}

async function extractDocxText(buffer: Buffer): Promise<string> {
  const result = await mammoth.extractRawText({ buffer });
  return result.value ?? "";
}

// PPTX is a zip of XML parts, not a single well-known "extract text" call
// like docx/pdf have. Rather than pull in a heavier, less-maintained
// PPTX-specific parser, this reads each slide's XML directly and pulls out
// the visible text runs (`<a:t>...</a:t>`), which is all the AI planner
// actually needs -- speaker notes and layout metadata aren't useful for
// summarising an assignment brief.
async function extractPptxText(buffer: Buffer): Promise<string> {
  const zip = await JSZip.loadAsync(buffer);

  const slideFiles = Object.keys(zip.files)
    .filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name))
    .sort((a, b) => {
      const numA = parseInt(a.match(/slide(\d+)\.xml$/)?.[1] ?? "0", 10);
      const numB = parseInt(b.match(/slide(\d+)\.xml$/)?.[1] ?? "0", 10);
      return numA - numB;
    });

  const slideTexts: string[] = [];
  for (const path of slideFiles) {
    const xml = await zip.files[path].async("text");
    const runs = [...xml.matchAll(/<a:t>([^<]*)<\/a:t>/g)].map((m) => m[1]);
    if (runs.length > 0) {
      slideTexts.push(runs.join(" "));
    }
  }

  return slideTexts.join("\n\n");
}

export async function extractFileContent(
  file: File,
  maxBytes: number
): Promise<ExtractedFile> {
  if (file.size > maxBytes) {
    throw new Error(
      `"${file.name}" is larger than your plan's ${Math.round(maxBytes / (1024 * 1024))}MB per-file limit. Upgrade for larger uploads.`
    );
  }

  // Images aren't converted to text at all -- they're passed straight to
  // the vision-capable model as image content, which is far more reliable
  // than any OCR step for a photographed or screenshotted assignment brief.
  if (file.type.startsWith("image/")) {
    const buffer = Buffer.from(await file.arrayBuffer());
    const base64 = buffer.toString("base64");
    return {
      name: file.name,
      text: "",
      imageDataUrl: `data:${file.type};base64,${base64}`,
    };
  }

  // `file.type` alone isn't reliable -- some browsers/drag-and-drop paths
  // leave it empty or generic even for a real PDF/DOCX/PPTX, and in that
  // case the old MIME-only check silently fell through to the raw-text
  // fallback below, which (confirmed by actually running a real PDF
  // through it with file.type="") returns the file's internal binary
  // structure as "text" instead of properly parsing it. Fall back to the
  // filename extension whenever the MIME type doesn't match a known one.
  const ext = extensionOf(file.name);
  const isPdf = file.type === PDF_MIME || (!file.type && ext === "pdf");
  const isDocx = file.type === DOCX_MIME || (!file.type && ext === "docx");
  const isPptx = file.type === PPTX_MIME || (!file.type && ext === "pptx");
  // Legacy pre-2007 Office formats (.doc, .ppt) are binary OLE2 containers,
  // not zipped XML -- mammoth/our pptx reader can't read them, and routing
  // them into the generic text fallback is what produced garbage "text"
  // (confirmed above: a real .doc's binary header decoded to a string of
  // replacement characters and passed the old printable-ratio check).
  // Reject these explicitly with guidance instead.
  const isLegacyOffice = file.type === "application/msword" || file.type === "application/vnd.ms-powerpoint" || (!file.type && (ext === "doc" || ext === "ppt"));

  if (isLegacyOffice) {
    return { name: file.name, text: "", note: "Older .doc/.ppt files aren't supported yet -- please save it as .docx/.pptx (or export as PDF) and upload that instead." };
  }

  try {
    let raw: string;

    if (isPdf) {
      raw = await extractPdfText(Buffer.from(await file.arrayBuffer()));
    } else if (isDocx) {
      raw = await extractDocxText(Buffer.from(await file.arrayBuffer()));
    } else if (isPptx) {
      raw = await extractPptxText(Buffer.from(await file.arrayBuffer()));
    } else {
      // text/plain, and anything else the bucket might allow in future --
      // fall back to the original raw-text + printable-ratio heuristic
      // rather than rejecting outright.
      const candidate = await file.text();
      const cleaned = stripHtml(candidate).replace(/\u0000/g, "");
      if (printableRatio(cleaned) < 0.6 && file.type !== "text/plain") {
        return { name: file.name, text: "", note: `Unreadable content (${file.type || "unknown type"})` };
      }
      raw = cleaned;
    }

    // Redact before compressing whitespace, not after -- the labeled-field
    // patterns in redactPersonalInfo bound a value at the next line break,
    // and compressWhitespace collapses every line break into a single
    // space. Redacting afterward would leave nothing to stop a match at
    // (e.g. "Name: John Smith\nModule: COMP301" -> collapsed first would
    // let the Name redaction run on into "Module: COMP301" too).
    const cleaned = compressWhitespace(redactPersonalInfo(stripHtml(raw)));
    if (!cleaned) {
      return { name: file.name, text: "", note: "No extractable text found" };
    }

    return { name: file.name, text: cleaned };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return { name: file.name, text: "", note: `Could not parse file (${message})` };
  }
}
