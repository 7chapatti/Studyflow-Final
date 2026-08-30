import { describe, it, expect } from "vitest";
import { redactPersonalInfo } from "./redact";

describe("redactPersonalInfo — reliable patterns", () => {
  it("redacts an email address", () => {
    const result = redactPersonalInfo("Submit to j.smith2024@university.ac.uk by Friday");
    expect(result).not.toContain("j.smith2024@university.ac.uk");
    expect(result).toContain("[EMAIL REDACTED]");
  });

  it("redacts multiple email addresses", () => {
    const result = redactPersonalInfo("Contact a@b.com or c@d.org");
    expect(result).not.toMatch(/a@b\.com|c@d\.org/);
  });

  it("redacts a UK postcode", () => {
    const result = redactPersonalInfo("Return to: 22 Example Street, London, SW1A 1AA");
    expect(result).not.toContain("SW1A 1AA");
    expect(result).toContain("[POSTCODE REDACTED]");
  });
});

describe("redactPersonalInfo — labeled fields", () => {
  it("redacts a labeled name, keeping the label", () => {
    const result = redactPersonalInfo("Name: John Smith\nModule: COMP301");
    expect(result).not.toContain("John Smith");
    expect(result).toContain("Name: [REDACTED]");
    expect(result).toContain("Module: COMP301");
  });

  it("redacts a labeled student ID", () => {
    const result = redactPersonalInfo("Student ID: 20451234");
    expect(result).not.toContain("20451234");
    expect(result).toContain("[REDACTED]");
  });

  it("redacts a labeled student number and candidate number variants", () => {
    expect(redactPersonalInfo("Student Number: 99001122")).toContain("[REDACTED]");
    expect(redactPersonalInfo("Candidate No: 5567")).toContain("[REDACTED]");
  });

  it("redacts a labeled date of birth (both DOB and full form)", () => {
    expect(redactPersonalInfo("DOB: 12/04/2003")).toContain("[REDACTED]");
    expect(redactPersonalInfo("Date of Birth: 12 April 2003")).toContain("[REDACTED]");
  });

  it("redacts a labeled address up to the line break", () => {
    const result = redactPersonalInfo("Address: 10 Downing Street\nDeadline: Friday");
    expect(result).not.toContain("10 Downing Street");
    expect(result).toContain("Deadline: Friday");
  });

  it("redacts a labeled phone/telephone/mobile number", () => {
    expect(redactPersonalInfo("Tel: 01865 555555")).toContain("[REDACTED]");
    expect(redactPersonalInfo("Phone: 07700 900000")).toContain("[REDACTED]");
    expect(redactPersonalInfo("Mobile: +44 7700 900000")).toContain("[REDACTED]");
  });

  it("stops a labeled value at a comma so trailing content on the same line survives", () => {
    const result = redactPersonalInfo("Name: John Smith, Module: COMP301");
    expect(result).toContain("Module: COMP301");
  });
});

describe("redactPersonalInfo — doesn't damage legitimate assignment content", () => {
  it("leaves word counts, section numbers, and dates alone", () => {
    const brief =
      "Write a 2000-word essay. Section 2.1 covers methodology. " +
      "Deadline: 15/03/2026. Module code: COMP30190. Academic year 2025/2026.";
    expect(redactPersonalInfo(brief)).toBe(brief);
  });

  it("leaves an unlabeled name in ordinary prose untouched (a known, disclosed limitation)", () => {
    const brief = "This essay was submitted by John Smith for assessment.";
    expect(redactPersonalInfo(brief)).toBe(brief);
  });

  it("leaves an unlabeled phone-shaped number alone rather than risk eating real content", () => {
    const brief = "Complete all 5 questions, each worth 20 marks, total 100 marks.";
    expect(redactPersonalInfo(brief)).toBe(brief);
  });

  it("is a no-op on empty input", () => {
    expect(redactPersonalInfo("")).toBe("");
  });
});
