// Physical keyboard geometry in millimetres.
// x: along the keyboard (A0 left edge = 0), y: away from the player (white key front = 0),
// z: up (white key top surface = 0).
export const W = 23.5;              // white key pitch
export const WHITE_W = 22.4;        // white key top width (gap between keys)
export const WHITE_L = 150;         // visible white key length
export const BLACK_W = 12.6;        // black key width at the base
export const BLACK_TOP_W = 9.4;     // black key width at the top (bevelled sides)
export const BLACK_L = 94;          // black key length (from y = WHITE_L - BLACK_L to WHITE_L)
export const BLACK_H = 12;          // black key top above white key top
export const KEY_DIP = 10;          // key travel at the front edge
export const PIVOT_Y = 430;         // key balance point behind the visible area
export const LOW = 21, HIGH = 108;
export const KEYBOARD_W = 52 * W;

const BLACK_PC = new Set([1, 3, 6, 8, 10]);
const BLACK_SHIFT = { 1: -2.6, 3: 2.6, 6: -3.2, 8: 0, 10: 3.2 }; // mm from the white-key boundary
const WHITES_BEFORE_PC = [0, 1, 1, 2, 2, 3, 4, 4, 5, 5, 6, 6];

export const isBlack = (m) => BLACK_PC.has(m % 12);

// Number of white keys strictly below midi m, counted from A0.
export function whiteIndex(m) {
  const oct = Math.floor(m / 12), pc = m % 12;
  return oct * 7 + WHITES_BEFORE_PC[pc] - (Math.floor(21 / 12) * 7 + WHITES_BEFORE_PC[21 % 12]);
}

const X_CACHE = new Float64Array(128);
for (let m = 0; m < 128; m++) {
  const wi = whiteIndex(m);
  X_CACHE[m] = isBlack(m) ? wi * W + BLACK_SHIFT[m % 12] : wi * W + W / 2;
}
export const keyX = (m) => X_CACHE[m];

// Where a fingertip touches the key (y along the key) — white keys are played further back
// when the hand is working among the black keys.
export const BLACK_FRONT_Y = WHITE_L - BLACK_L;
export function contactY(m, blackMode) {
  if (isBlack(m)) return BLACK_FRONT_Y + 24;
  return blackMode ? BLACK_FRONT_Y - 8 : 34;
}
export const keyTopZ = (m) => (isBlack(m) ? BLACK_H : 0);

const NAMES = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'];
// Spelling for C♯ minor context (B♯ / F𝄪 occasionally appear, but sharps read best here).
export const noteName = (m) => NAMES[m % 12];
export const octaveOf = (m) => Math.floor(m / 12) - 1;
