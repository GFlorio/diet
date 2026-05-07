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

/** @param {Uint8Array} bytes */
function toBase64Url(bytes){
  let binary = '';
  for (const byte of bytes) { binary += String.fromCharCode(byte); }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** @param {string} value */
function fromBase64Url(value){
  const binary = atob(value.replace(/-/g, '+').replace(/_/g, '/'));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) { bytes[i] = binary.charCodeAt(i); }
  return bytes;
}

/** @param {number} value */
function scale(value){
  const scaledValue = Math.round(Number(value) * SCALE);
  if (!Number.isFinite(scaledValue) || scaledValue < 0 || scaledValue > MAX_SCALED) {
    throw new RangeError(`value out of range for Uint16 share code: ${value}`);
  }
  return scaledValue;
}

/**
 * @param {{ name: string, refLabel: string, kcal: number, prot: number, carbs: number, fats: number }} food
 */
export function encodeFoodCode(food){
  const encoder = new TextEncoder();
  const nameBytes = encoder.encode(food.name);
  const refBytes = encoder.encode(food.refLabel);
  if (nameBytes.length > 255) { throw new RangeError('name too long for share code'); }
  const bytes = new Uint8Array(HEADER_BYTES + nameBytes.length + refBytes.length);
  const view = new DataView(bytes.buffer);
  view.setUint16(0, scale(food.kcal));
  view.setUint16(2, scale(food.prot));
  view.setUint16(4, scale(food.carbs));
  view.setUint16(6, scale(food.fats));
  bytes[8] = nameBytes.length;
  bytes.set(nameBytes, HEADER_BYTES);
  bytes.set(refBytes, HEADER_BYTES + nameBytes.length);
  return toBase64Url(bytes);
}

/**
 * Decode a food share code. Returns null if the code is malformed.
 * @param {string} code
 * @returns {{ name: string, refLabel: string, kcal: string, prot: string, carbs: string, fats: string } | null}
 */
export function decodeFoodCode(code){
  try {
    const bytes = fromBase64Url(code);
    if (bytes.length < HEADER_BYTES) { return null; }
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const kcal = view.getUint16(0) / SCALE;
    const prot = view.getUint16(2) / SCALE;
    const carbs = view.getUint16(4) / SCALE;
    const fats = view.getUint16(6) / SCALE;
    const nameLen = bytes[8];
    const nameEnd = HEADER_BYTES + nameLen;
    if (bytes.length < nameEnd) { return null; }
    const decoder = new TextDecoder();
    const name = decoder.decode(bytes.subarray(HEADER_BYTES, nameEnd));
    const refLabel = decoder.decode(bytes.subarray(nameEnd));
    if (!name || !refLabel) { return null; }
    return { name, refLabel, kcal: String(kcal), prot: String(prot), carbs: String(carbs), fats: String(fats) };
  } catch {
    return null;
  }
}
