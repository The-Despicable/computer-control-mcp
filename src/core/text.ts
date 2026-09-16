/**
 * Bounded paging over a fetched text window. The PowerShell primitive returns
 * up to `max_chars` of a document's UIA text plus whether it was the whole
 * document; the slicing/offset/truncation semantics live here so they are
 * deterministically unit-testable without Windows.
 */
export interface TextPage {
  text: string;
  offset: number;
  limit: number;
  returned_chars: number;
  /** Total character count, or null when the document window was truncated. */
  total_known: number | null;
  /** True when more text exists after the returned page. */
  truncated: boolean;
}

export function slicePage(fullFetched: string, offset: number, limit: number, complete: boolean): TextPage {
  const len = fullFetched.length;
  const start = Math.max(0, Math.floor(offset));
  const lim = Math.max(0, Math.floor(limit));
  const text = start >= len ? "" : fullFetched.slice(start, start + lim);
  const totalKnown = complete ? len : null;
  // If the fetch was complete, truncation means the document extends past the page.
  // If incomplete, we cannot prove there is no more text, so report truncated.
  const truncated = complete ? (start + text.length) < len : true;
  return { text, offset: start, limit: lim, returned_chars: text.length, total_known: totalKnown, truncated };
}
