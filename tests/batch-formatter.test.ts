import { describe, it, expect } from "vitest";
import { formatBatchQueryResults } from "../src/server";

// A batch whose chunks are each shorter than extractSnippet's window is the case that matters:
// extractSnippet returns the content VERBATIM when content.length <= maxLen, so the excerpt is
// identical no matter which query matched it. Every query's top-K therefore re-emits the same
// bytes, and a 3-query batch over 3 small sections costs 9 copies instead of 3.
const chunk = (title: string, content: string) => ({ title, content, highlighted: undefined });

const storeOf = (byQuery: Record<string, unknown[]>) =>
  ({
    searchWithFallback: (query: string) => byQuery[query] ?? [],
  }) as never;

const format = (store: unknown, queries: string[]) =>
  formatBatchQueryResults(store as never, queries, "batch-src", 80 * 1024, "batch").join("\n");

describe("formatBatchQueryResults — identical excerpt suppression", () => {
  it("emits a byte-identical excerpt once and points back for a later query", () => {
    const shared = chunk("shared-section", "SHARED_BODY zebra corridor 41.7 km");
    const out = format(storeOf({ q1: [shared], q2: [shared] }), ["q1", "q2"]);

    expect(out.match(/SHARED_BODY zebra corridor 41\.7 km/g)).toHaveLength(1);
    expect(out).toContain("identical excerpt already shown under `q1`");
  });

  it("still lists the section under the later query, so the match is not hidden", () => {
    const shared = chunk("shared-section", "BODY");
    const out = format(storeOf({ q1: [shared], q2: [shared] }), ["q1", "q2"]);

    // both query headings present, and the title appears under each
    expect(out).toContain("## q1");
    expect(out).toContain("## q2");
    expect(out.match(/### shared-section/g)).toHaveLength(2);
  });

  it("does not suppress when the same title yields a DIFFERENT excerpt", () => {
    // Long content is windowed around the query, so the excerpt is query-dependent. Dedupe must
    // key on title+snippet, not title alone, or it would discard query-specific context.
    const out = format(
      storeOf({ q1: [chunk("t", "EXCERPT_FOR_Q1")], q2: [chunk("t", "EXCERPT_FOR_Q2")] }),
      ["q1", "q2"],
    );

    expect(out).toContain("EXCERPT_FOR_Q1");
    expect(out).toContain("EXCERPT_FOR_Q2");
    expect(out).not.toContain("identical excerpt");
  });

  it("keeps distinct sections under a single query", () => {
    const out = format(
      storeOf({ q1: [chunk("s1", "FIRST"), chunk("s2", "SECOND")] }),
      ["q1"],
    );

    expect(out).toContain("FIRST");
    expect(out).toContain("SECOND");
    expect(out).not.toContain("identical excerpt");
  });

  it("counts the suppressed copy cheaply against maxOutput", () => {
    // Body must stay UNDER extractSnippet's 3000-char window: above it the content is windowed
    // (so the excerpt is query-dependent and correctly NOT suppressed), below it it is verbatim.
    const body = "X".repeat(2000);
    const shared = chunk("big", body);
    const queries = ["q1", "q2", "q3", "q4"];
    const out = format(storeOf(Object.fromEntries(queries.map((q) => [q, [shared]]))), queries);

    expect(out.match(/X{2000}/g)).toHaveLength(1);
    expect(out.match(/identical excerpt already shown under/g)).toHaveLength(3);
  });

  it("preserves the no-match branch", () => {
    const out = format(storeOf({ q1: [] }), ["q1"]);
    expect(out).toContain("No matching sections found.");
  });
});
