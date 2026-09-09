// src/lib/redact.ts
//
// Best-effort redaction of personal information from extracted brief text,
// applied before that text is ever included in a prompt to OpenAI. This is
// deliberately pattern-based rather than a general PII/NER detector -- see
// the honesty note at the bottom of this file for exactly what that does
// and doesn't cover. It only ever touches text extracted from *uploaded
// files* (see file-extract.ts) -- the assignment description a student
// types directly isn't run through this.

// Reliable, low-false-positive patterns: these have a distinctive enough
// shape that redacting every match is safe without needing a label nearby.
const EMAIL_PATTERN = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;

// UK postcode (e.g. "SW1A 1AA", "M1 1AE"). Specific enough that it's very
// unlikely to false-positive against genuine assignment content (module
// codes, word counts, section numbers).
const UK_POSTCODE_PATTERN = /\b[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}\b/gi;

// Labeled personal fields: a recognizable field label immediately followed
// by its value, up to the next line break or a clear delimiter. Anchoring
// on the label is what keeps this safe -- a bare run of digits could be a
// word count, a year, or a module code, but "Student ID: 12345678" is
// unambiguous. The label itself is kept (it carries no personal
// information and gives the AI useful context, e.g. that a checklist
// section is a cover-page field rather than an instruction) -- only the
// value after it is redacted.
const LABELED_FIELD_PATTERN =
  /\b(Name|Student\s*(?:ID|Number|No\.?)|Candidate\s*(?:Number|No\.?)|Date\s*of\s*Birth|DOB|Home\s*Address|Address|Tel(?:ephone)?|Phone|Mobile)\s*[:\-]\s*([^\n,;]+)/gi;

export function redactPersonalInfo(text: string): string {
  if (!text) return text;

  let result = text;
  result = result.replace(EMAIL_PATTERN, "[EMAIL REDACTED]");
  result = result.replace(UK_POSTCODE_PATTERN, "[POSTCODE REDACTED]");
  result = result.replace(LABELED_FIELD_PATTERN, (_match, label: string) => `${label}: [REDACTED]`);

  return result;
}

// ── Honesty note ─────────────────────────────────────────────────────────────
//
// What this reliably catches: email addresses, UK postcodes, and any
// personal field that appears after one of the labels above (name, student
// ID/number, candidate number, date of birth, address, phone/mobile) --
// which covers the common case of a university cover page or footer with
// labeled fields.
//
// What this does NOT catch, and can't without a fundamentally different
// approach:
// - A name mentioned in ordinary prose with no label ("Submitted by John
//   Smith" without a "Name:" label) -- reliably distinguishing a person's
//   name from any other two capitalized words requires actual named-entity
//   recognition, not pattern matching, and a low-precision attempt at this
//   would start eating real assignment content (module names, author names
//   in citations, place names in essay prompts).
// - A bare phone number with no label. Phone number formats are too varied
//   and share too much shape with legitimate assignment numbers (word
//   counts, dates, module codes) to redact by pattern alone without a real
//   risk of corrupting the brief's actual requirements -- which would
//   directly hurt the thing this app exists to get right. Labeled phone
//   numbers ("Tel: ...", "Phone: ...") ARE caught.
// - Any personal information embedded in an *image* -- a photographed or
//   screenshotted brief with a name, logo, or ID visibly printed on it.
//   Image uploads are sent to the vision model as pixels, not run through
//   this (or any) text pipeline, and there's no reasonable way to redact
//   visual content without an image-understanding pass of its own --
//   which would mean sending the image to a model to decide what to redact
//   before sending it to a model, defeating the point. If a brief is a
//   photo of a printed letter, whatever's visibly printed on it is what
//   gets sent.
//
// In short: this measurably reduces what leaves the server in the common,
// structured cases, but it is not a guarantee that no personal information
// ever reaches OpenAI. Don't represent it as one.
