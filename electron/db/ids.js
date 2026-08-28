/**
 * Co-op local data layer — client-generated IDs (ULID).
 *
 * Offline writes happen with the server unavailable, so entity IDs must be
 * generated locally. ULIDs are 128-bit Crockford-Base32: a 48-bit
 * millisecond timestamp followed by 80 random bits. That makes them:
 *
 *   * unique to a very high probability (80 random bits),
 *   * time-ordered / sortable (newer > older), which is nicer for a local
 *     ledger than random UUIDs,
 *   * safe to type (Crockford alphabet excludes I, L, O, U).
 *
 * The server maps each client_id to its own integer id on sync (ADR-002).
 */
'use strict';

const crypto = require('node:crypto');

// Crockford Base32 (no I, L, O, U).
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/** Encode 16 bytes (128 bits) as a 26-char Crockford-Base32 string. */
function encode128(buf) {
  let n = BigInt(0);
  for (let i = 0; i < buf.length; i++) n = (n << 8n) | BigInt(buf[i]);
  const chars = [];
  for (let i = 0; i < 26; i++) {
    chars.push(ALPHABET[Number(n & 31n)]);
    n >>= 5n;
  }
  return chars.reverse().join('');
}

/** Generate a ULID: 48-bit ms timestamp + 80 random bits. */
function ulid(ts = Date.now()) {
  const buf = Buffer.alloc(16);
  // 48-bit timestamp, big-endian: high 32 bits (ts >> 16) then low 16 bits.
  buf.writeUInt32BE(Math.floor(ts / 0x10000) & 0xffffffff, 0);
  buf.writeUInt16BE(ts & 0xffff, 4);
  // 80 random bits into the last 10 bytes.
  crypto.randomFillSync(buf.subarray(6));
  return encode128(buf);
}

module.exports = { ulid };
