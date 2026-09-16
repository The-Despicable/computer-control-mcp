import type { Rect } from "./geometry.js";
import type { TextMatch } from "../deps.js";

/**
 * OCR tiling + combination, owned by TypeScript so it is unit-testable without
 * a real OCR engine. PowerShell exposes only a "recognize one bounded tile"
 * primitive (`ocr.ps1`); the tiling plan, tile-local -> global coordinate
 * reconstruction, and truncation semantics live here.
 *
 * Truncation contract:
 *   `truncated` is true ONLY when content was actually omitted, capped, or
 *   otherwise not represented in the returned matches. Processing every tile
 *   of an oversized image is normal operation and must NOT set truncated.
 */

export interface OcrLine {
  text: string;
  /** Tile-local rectangle (relative to the tile origin), in pixels. */
  rect: Rect;
}

export interface OcrCombineParams {
  region: Rect;
  maxDim: number;
  maxMatches: number;
  /** True when the caller asked for OCR and the engine reported availability. */
  ocrAvailable: boolean;
  /** Text predicate (substring / regex) already validated by the caller. */
  test: (text: string) => boolean;
  /** Recognizes exactly one bounded tile, returning tile-local lines. */
  runTile: (tile: Rect) => Promise<OcrLine[]>;
  /** Observability hook: invoked when a tile fails (its content is then omitted). */
  onTileError?: (tile: Rect, error: unknown) => void;
}

export interface OcrCombineResult {
  matches: TextMatch[];
  tiles_total: number;
  tiles_processed: number;
  tiles_failed: number;
  truncated: boolean;
  engines_used: string[];
}

/**
 * Split a region into tiles no larger than `maxDim` on either axis. A region
 * within the limit yields exactly one tile equal to the region.
 */
export function planOcrTiles(region: Rect, maxDim: number): Rect[] {
  if (!Number.isFinite(maxDim) || maxDim < 1) throw new Error("maxDim must be a positive integer");
  const w = Math.max(0, Math.floor(region.w));
  const h = Math.max(0, Math.floor(region.h));
  if (w === 0 || h === 0) return [];
  const tiles: Rect[] = [];
  for (let y = region.y; y < region.y + h; y += maxDim) {
    for (let x = region.x; x < region.x + w; x += maxDim) {
      tiles.push({
        x,
        y,
        w: Math.min(maxDim, region.x + w - x),
        h: Math.min(maxDim, region.y + h - y),
      });
    }
  }
  return tiles;
}

/**
 * Process every tile and reconstruct global coordinates. A failed tile is
 * counted and sets `truncated` (its content is, truthfully, missing); it does
 * not abort the whole recognition.
 */
export async function collectOcrMatches(params: OcrCombineParams): Promise<OcrCombineResult> {
  const { region, maxDim, maxMatches, ocrAvailable, test, runTile } = params;
  const tiles = planOcrTiles(region, maxDim);
  const matches: TextMatch[] = [];
  let tilesFailed = 0;
  let truncated = false;

  for (const tile of tiles) {
    if (matches.length >= maxMatches) {
      truncated = true;
      break;
    }
    let lines: OcrLine[];
    try {
      lines = await runTile(tile);
    } catch (err) {
      tilesFailed += 1;
      truncated = true; // this tile's content is omitted
      params.onTileError?.(tile, err);
      continue;
    }
    for (const line of lines) {
      if (matches.length >= maxMatches) {
        truncated = true;
        break;
      }
      const text = (line.text ?? "").trim();
      if (!text || !test(text)) continue;
      // Tile-local -> global: offset by the tile origin. Never return tile-local
      // rectangles as if they were global.
      const rx = tile.x + line.rect.x;
      const ry = tile.y + line.rect.y;
      matches.push({
        text,
        source: "ocr",
        control_type: null,
        class_name: null,
        automation_id: null,
        process_id: null,
        is_offscreen: false,
        bounds: { x: rx, y: ry, w: line.rect.w, h: line.rect.h },
        center: { x: rx + Math.floor(line.rect.w / 2), y: ry + Math.floor(line.rect.h / 2) },
      });
    }
  }

  return {
    matches,
    tiles_total: tiles.length,
    tiles_processed: tiles.length - tilesFailed,
    tiles_failed: tilesFailed,
    truncated,
    engines_used: ocrAvailable ? ["ocr"] : [],
  };
}
