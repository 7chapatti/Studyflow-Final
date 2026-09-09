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
