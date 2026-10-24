import { describe, it, expect } from "vitest";
import { extractFileContent } from "./file-extract";

function makeTextFile(content: string, name = "brief.txt"): File {
  return new File([content], name, { type: "text/plain" });
}

describe("extractFileContent — PII redaction runs before whitespace is collapsed", () => {
  it("redacts a labeled field without swallowing the next line's content", async () => {
    // If redaction ran after compressWhitespace (which collapses newlines
    // into spaces), the labeled-value pattern would have nothing to stop
    // it at and could eat "Module: COMP301" too. This is exactly the
    // ordering bug the fix addresses.
    const file = makeTextFile("Name: John Smith\nModule: COMP301\nDeadline: Friday");
    const result = await extractFileContent(file, 1_000_000);

    expect(result.text).not.toContain("John Smith");
    expect(result.text).toContain("Module: COMP301");
    expect(result.text).toContain("Deadline: Friday");
  });

  it("redacts an email address found in an uploaded file", async () => {
    const file = makeTextFile("Questions? Email tutor@university.ac.uk for help.");
    const result = await extractFileContent(file, 1_000_000);

    expect(result.text).not.toContain("tutor@university.ac.uk");
    expect(result.text).toContain("[EMAIL REDACTED]");
  });

  it("leaves ordinary assignment content untouched", async () => {
    const file = makeTextFile("Write a 2000 word essay. Deadline: 15/03/2026.");
    const result = await extractFileContent(file, 1_000_000);

    expect(result.text).toBe("Write a 2000 word essay. Deadline: 15/03/2026.");
  });
});

describe("extractFileContent — binary-format detection doesn't rely on MIME type alone", () => {
  it("rejects legacy .doc/.ppt with a clear note instead of returning decoded binary garbage", async () => {
    // Invalid UTF-8 byte sequences (as in any OLE2 .doc/.ppt file) decode to
    // the replacement character U+FFFD, which used to pass the "is this
    // printable text?" heuristic and get sent to the AI as if it were the
    // brief's real content.
    const buf = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0, 0, 0, 0]);
    const file = new File([buf], "brief.doc", { type: "application/msword" });
    const result = await extractFileContent(file, 1_000_000);

    expect(result.text).toBe("");
    expect(result.note).toContain("doc/.ppt");
  });

  it("falls back to the filename extension when the browser sends no MIME type", async () => {
    // Drag-and-drop in some browsers leaves file.type empty even for a real
    // PDF/DOCX/PPTX; without an extension fallback this silently returned
    // the file's raw internal structure as "text" instead of parsing it.
    const content = "%PDF-1.4\n1 0 obj<< /Type /Catalog >>endobj\n%%EOF";
    const file = new File([content], "brief.pdf", { type: "" });
    const result = await extractFileContent(file, 1_000_000);

    // A malformed PDF like this won't extract real text, but it must go
    // through the PDF parser (and fail/empty there) rather than being
    // treated as plain text and returning the raw PDF source verbatim.
    expect(result.text).not.toContain("obj<<");
  });
});
