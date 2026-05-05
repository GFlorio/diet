/**
 * Compact share-code codec for foods.
 *
 * Binary layout (then base64url encoded):
 *   bytes 0..7   : 4× Uint16 big-endian — kcal, prot, carbs, fats (each ×10, one decimal)
 *   byte  8      : name length in UTF-8 bytes (0..255)
 *   bytes 9..    : name (UTF-8), then refLabel (UTF-8) consuming the rest.
 */
const HEADER_BYTES = 9;
const SCALE = 10;
const MAX_SCALED = 0xFFFF;

/** @param {Uint8Array} u8 */
function toBase64Url(u8){
  let bin = '';
  for (const b of u8) { bin += String.fromCharCode(b); }
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** @param {string} s */
function fromBase64Url(s){
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/'));
  const u8 = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) { u8[i] = bin.charCodeAt(i); }
  return u8;
}

/** @param {number} n */
function scale(n){
  const v = Math.round(Number(n) * SCALE);
  if (!Number.isFinite(v) || v < 0 || v > MAX_SCALED) {
    throw new RangeError(`value out of range for Uint16 share code: ${n}`);
  }
  return v;
}

/**
 * @param {{ name: string, refLabel: string, kcal: number, prot: number, carbs: number, fats: number }} f
 */
export function encodeFoodCode(f){
  const enc = new TextEncoder();
  const nameBytes = enc.encode(f.name);
  const refBytes = enc.encode(f.refLabel);
  if (nameBytes.length > 255) { throw new RangeError('name too long for share code'); }
  const u8 = new Uint8Array(HEADER_BYTES + nameBytes.length + refBytes.length);
  const view = new DataView(u8.buffer);
  view.setUint16(0, scale(f.kcal));
  view.setUint16(2, scale(f.prot));
  view.setUint16(4, scale(f.carbs));
  view.setUint16(6, scale(f.fats));
  u8[8] = nameBytes.length;
  u8.set(nameBytes, HEADER_BYTES);
  u8.set(refBytes, HEADER_BYTES + nameBytes.length);
  return toBase64Url(u8);
}

/**
 * Decode a food share code. Returns null if the code is malformed.
 * @param {string} code
 * @returns {{ name: string, refLabel: string, kcal: string, prot: string, carbs: string, fats: string } | null}
 */
export function decodeFoodCode(code){
  try {
    const u8 = fromBase64Url(code);
    if (u8.length < HEADER_BYTES) { return null; }
    const view = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
    const kcal = view.getUint16(0) / SCALE;
    const prot = view.getUint16(2) / SCALE;
    const carbs = view.getUint16(4) / SCALE;
    const fats = view.getUint16(6) / SCALE;
    const nameLen = u8[8];
    const nameEnd = HEADER_BYTES + nameLen;
    if (u8.length < nameEnd) { return null; }
    const dec = new TextDecoder();
    const name = dec.decode(u8.subarray(HEADER_BYTES, nameEnd));
    const refLabel = dec.decode(u8.subarray(nameEnd));
    if (!name || !refLabel) { return null; }
    return { name, refLabel, kcal: String(kcal), prot: String(prot), carbs: String(carbs), fats: String(fats) };
  } catch {
    return null;
  }
}
