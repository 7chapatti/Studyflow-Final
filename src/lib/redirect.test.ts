import { describe, it, expect } from "vitest";
import { safeRedirectPath } from "./redirect";

describe("safeRedirectPath", () => {
  it("keeps ordinary same-site paths, including query and hash", () => {
    expect(safeRedirectPath("/dashboard")).toBe("/dashboard");
    expect(safeRedirectPath("/dashboard/assignment/abc?tab=tasks#top")).toBe(
      "/dashboard/assignment/abc?tab=tasks#top"
    );
    expect(safeRedirectPath("/settings?calendar=connected")).toBe("/settings?calendar=connected");
  });

  it("falls back when nothing was supplied", () => {
    expect(safeRedirectPath(null)).toBe("/dashboard");
    expect(safeRedirectPath(undefined)).toBe("/dashboard");
    expect(safeRedirectPath("")).toBe("/dashboard");
  });

  it("uses the supplied fallback", () => {
    expect(safeRedirectPath(null, "/settings")).toBe("/settings");
  });

  it("rejects absolute URLs to other sites", () => {
    expect(safeRedirectPath("https://evil.com")).toBe("/dashboard");
    expect(safeRedirectPath("http://evil.com/dashboard")).toBe("/dashboard");
    expect(safeRedirectPath("javascript:alert(1)")).toBe("/dashboard");
  });

  it("rejects protocol-relative URLs", () => {
    expect(safeRedirectPath("//evil.com")).toBe("/dashboard");
    expect(safeRedirectPath("//evil.com/dashboard")).toBe("/dashboard");
  });

  it("rejects backslash variants that browsers resolve to another site", () => {
    expect(safeRedirectPath("/\\evil.com")).toBe("/dashboard");
    expect(safeRedirectPath("/\\/evil.com")).toBe("/dashboard");
    expect(safeRedirectPath("\\\\evil.com")).toBe("/dashboard");
  });

  it("rejects control characters that URL parsers strip", () => {
    expect(safeRedirectPath("/\t/evil.com")).toBe("/dashboard");
    expect(safeRedirectPath("/\n/evil.com")).toBe("/dashboard");
  });

  it("rejects paths that don't start with a slash", () => {
    expect(safeRedirectPath("dashboard")).toBe("/dashboard");
    expect(safeRedirectPath("evil.com")).toBe("/dashboard");
  });
});
