import { ObservationStore, type Observation, type StateLike } from "./core/store.js";
import { Policy } from "./core/policy.js";
import type { Rect, Monitor } from "./core/geometry.js";
import type { ForegroundInfo } from "./core/policy.js";
import type { CapabilityReport } from "./core/capability.js";

/** Live desktop state at one instant: geometry + foreground + cursor + capture time. */
export interface CurrentUiState {
  monitors: Monitor[]; virtual_screen: Rect; foreground: ForegroundInfo | null;
  cursor?: { x: number; y: number } | null; timestamp: number;
}

/** One located text/element hit. Bounds/center are desktop-absolute pixels. */
export interface TextMatch {
  text: string; source: "uia" | "ocr";
  bounds: Rect; center: { x: number; y: number };
  control_type?: string | null; class_name?: string | null; automation_id?: string | null;
  process_id?: number | null; is_offscreen?: boolean;
}

/** Pure perception payload: what was found, how, and with what coverage. No geometry. */
export interface PerceptionResult {
  mode: string; matches: TextMatch[]; engines_used: string[];
  ocr_available: boolean; truncated: boolean;
  visited?: number; elapsed_ms?: number;
}

/**
 * Complete perception outcome: live state AND matches together.
 * The backend MUST return both; a match list alone can never bind input.
 */
export type PerceiveOutcome = CurrentUiState & PerceptionResult;

export interface CaptureRequest {
  target: string | { monitor: number } | { window: number } | { x: number; y: number; w: number; h: number };
  format?: "png" | "jpeg"; quality?: number; max_dimension?: number; thumbprint_only?: boolean;
}

export interface CaptureResult extends CurrentUiState {
  screenshot_b64: string | null; format: "png" | "jpeg";
  width: number; height: number; origin: { x: number; y: number };
  scale: number; region: Rect; thumbprint_b64: string;
}

export interface WindowEntry {
  hwnd: number; pid: number; process: string; title: string;
  bounds: Rect; is_foreground: boolean; is_minimized: boolean; z: number;
}

export interface WindowsResult extends CurrentUiState {
  windows: WindowEntry[];
}

export interface PerceiveRequest {
  mode: "text" | "element" | "summary";
  text?: string; regex?: string; name?: string; control_type?: string;
  automation_id?: string; class_name?: string;
  scope: "foreground" | "desktop"; engine?: "auto" | "uia" | "ocr"; limit?: number;
}

export type InputAction =
  | { action: "click"; x: number; y: number; button: "left" | "right" | "middle"; count: 1 | 2 }
  | { action: "scroll"; direction: "up" | "down"; amount: number; x?: number; y?: number }
  | { action: "type"; text: string }
  | { action: "keys"; keys: Array<{ vk: number; ext: boolean }> }
  | { action: "drag"; from: { x: number; y: number }; to: { x: number; y: number }; button: "left" | "right" | "middle"; duration_ms: number };

export interface InputExpectation {
  foreground_hwnd: number; virtual_screen: Rect; monitors_hash: string;
}

export type InputRequest = InputAction & { expect: InputExpectation };

export interface Backend {
  capture(req: CaptureRequest): Promise<CaptureResult>;
  state(): Promise<CurrentUiState>;
  windows(): Promise<WindowsResult>;
  focus(hwnd: number): Promise<CurrentUiState>;
  perceive(req: PerceiveRequest): Promise<PerceiveOutcome>;
  input(req: InputRequest): Promise<InputResult>;
  /** Startup capability report; optional so test/alternate backends stay simple. */
  capabilities?(): CapabilityReport | undefined;
}

/** Result of a validated input injection: post-action UI state plus transport metadata. */
export interface InputResult {
  state: CurrentUiState;
  /** False when a paste transport could not restore the prior clipboard (text still sent). */
  clipboard_restored?: boolean;
  /** Which transport actually delivered typed text. */
  transport?: "clipboard" | "unicode";
}

export interface Ctx { store: ObservationStore; policy: Policy; backend: Backend }

export function createCtx(deps: { backend: Backend; policy: Policy }): Ctx {
  return { backend: deps.backend, policy: deps.policy,
    store: new ObservationStore(deps.policy.observationCache, deps.policy.maxObservationAgeMs) };
}

/**
 * Type-safe perception binding (§9): only a full PerceiveOutcome
 * (CurrentUiState + PerceptionResult) may mint an ObservationBinding.
 * Passing a bare match list does not typecheck — an OCR hit is never
 * mistaken for a desktop observation.
 */
export function bindPerceptionOutcome(store: ObservationStore, outcome: PerceiveOutcome): Observation {
  const state: StateLike = {
    monitors: outcome.monitors, virtual_screen: outcome.virtual_screen,
    foreground: outcome.foreground, cursor: outcome.cursor, timestamp: outcome.timestamp,
  };
  return store.addBinding(state);
}

/** ObservationBinding is the input-capable handle minted from a live observation. */
export type ObservationBinding = Observation;
