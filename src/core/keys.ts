import { fail } from "./errors.js";

export interface KeySpec { vk: number; ext: boolean; modifier: boolean }

const MODIFIERS: Record<string, true> = { win: true, ctrl: true, alt: true, shift: true };
const EXTENDED: Record<string, true> = {
  insert: true, delete: true, home: true, end: true, pageup: true, pagedown: true,
  left: true, up: true, right: true, down: true, divide: true, printscreen: true, numlock: true, rwin: true,
};

const TABLE: Record<string, number> = {
  backspace: 0x08, tab: 0x09, enter: 0x0d, shift: 0x10, ctrl: 0x11, alt: 0x12,
  capslock: 0x14, escape: 0x1b, space: 0x20, pageup: 0x21, pagedown: 0x22, end: 0x23,
  home: 0x24, left: 0x25, up: 0x26, right: 0x27, down: 0x28, printscreen: 0x2c,
  insert: 0x2d, delete: 0x2e, help: 0x2f, lwin: 0x5b, win: 0x5b, rwin: 0x5c, apps: 0x5d,
  sleep: 0x5f, numpadmultiply: 0x6a, numpadadd: 0x6b, numpadseparator: 0x6c,
  numpadsubtract: 0x6d, numpaddecimal: 0x6e, numpaddivide: 0x6f, numlock: 0x90,
  scrolllock: 0x91, lshift: 0xa0, rshift: 0xa1, lctrl: 0xa2, rctrl: 0xa3, lalt: 0xa4, ralt: 0xa5,
  browserback: 0xa6, browserforward: 0xa7, browserrefresh: 0xa8, browserstop: 0xa9,
  browsersearch: 0xaa, browserfavorites: 0xab, browserhome: 0xac,
  volumemute: 0xad, volumedown: 0xae, volumeup: 0xaf,
  medianext: 0xb0, mediaprevious: 0xb1, mediastop: 0xb2, mediaplay: 0xb3,
  semicolon: 0xba, equal: 0xbb, comma: 0xbc, minus: 0xbd, period: 0xbe, slash: 0xbf,
  backtick: 0xc0, bracketleft: 0xdb, backslash: 0xdc, bracketright: 0xdd, quote: 0xde,
};

const ALIASES: Record<string, string> = {
  return: "enter", cr: "enter", esc: "escape", del: "delete", control: "ctrl",
  option: "alt", cmd: "win", meta: "win", super: "win", prtsc: "printscreen",
  pgup: "pageup", pgdn: "pagedown", pgdown: "pagedown", menu: "apps",
};

for (let i = 0; i <= 9; i++) TABLE[String(i)] = 0x30 + i;
for (let i = 0; i < 26; i++) TABLE[String.fromCharCode(97 + i)] = 0x41 + i; // a..z
for (let i = 0; i < 10; i++) TABLE[`numpad${i}`] = 0x60 + i;
for (let i = 1; i <= 24; i++) TABLE[`f${i}`] = 0x6f + i; // f1=0x70 ... f24=0x87

export function normalizeKeyName(raw: string): string | null {
  const k = raw.trim().toLowerCase();
  const aliased = ALIASES[k] ?? k;
  return TABLE[aliased] !== undefined ? aliased : null;
}

/**
 * Parses a chord like "ctrl+shift+t" into an ordered down-sequence.
 * Fails with UNKNOWN_KEY for any unrecognized token BEFORE anything is injected.
 * Fails with INVALID_ARGUMENT if the chord has no single non-modifier key.
 */
export function parseChord(input: string): KeySpec[] {
  const parts = input.split("+").map(s => s.trim()).filter(Boolean);
  if (parts.length === 0) fail("INVALID_ARGUMENT", `empty key chord`, { input });
  const specs: { name: string; vk: number }[] = [];
  for (const p of parts) {
    const n = normalizeKeyName(p);
    if (!n) fail("UNKNOWN_KEY", `unknown key name "${p}"`, { input },
      "use names like: a-z 0-9 f1-f24 enter tab escape space backspace delete home end pageup pagedown left right up down ctrl alt shift win");
    specs.push({ name: n, vk: TABLE[n] as number });
  }
  const nonMods = specs.filter(s => !MODIFIERS[s.name]);
  if (nonMods.length !== 1) fail("INVALID_ARGUMENT",
    `chord must contain exactly one non-modifier key (got ${nonMods.length})`, { input });
  const order: Record<string, number> = { win: 0, ctrl: 1, alt: 2, shift: 3 };
  const mods = specs.filter(s => MODIFIERS[s.name]).sort((a, b) => (order[a.name] as number) - (order[b.name] as number));
  return [...mods, nonMods[0] as { name: string; vk: number }].map(s => ({ vk: s.vk, ext: Boolean(EXTENDED[s.name]), modifier: Boolean(MODIFIERS[s.name]) }));
}

export function assertTypableText(text: string) {
  // Deterministic separation: type() can never express a shortcut (§3 keyboard).
  const bad = /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.exec(text);
  if (bad) fail("INVALID_ARGUMENT", `text contains a raw control character (0x${(bad[0] as string).charCodeAt(0).toString(16)}); use key_press for keys/chords`,
    { index: bad.index });
}
