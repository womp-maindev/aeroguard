// Reference model of the Aiken validator in cardano/onchain: the exact bytes it rebuilds and the checks it makes,
// using only what Plutus V3 offers (keccak_256 and verifyEcdsaSecp256k1Signature, which takes a 33-byte compressed
// public key and a 64-byte r‖s signature, with no public-key recovery). Tests run it on the real Airnode signature.
import { secp256k1 } from '@noble/curves/secp256k1.js';
import { concat, encodePacked, type Hex, hexToBytes, keccak256, recoverPublicKey, toHex } from 'viem';
import { publicKeyToAddress } from 'viem/accounts';
import type { SignedResponse } from '../../keeper/src/airnode-v2.ts';

export const ETH_PREFIX = toHex('\x19Ethereum Signed Message:\n32');

/** Compressed secp256k1 key of the Airnode, recovered once off chain from any of its signatures. */
export const compressedSigner = async (r: SignedResponse): Promise<Hex> => {
  const inner = keccak256(encodePacked(['bytes32', 'uint256', 'bytes'], [r.requestHash, BigInt(r.timestamp), toHex(r.data)]));
  const uncompressed = await recoverPublicKey({ hash: keccak256(concat([ETH_PREFIX, inner])), signature: r.signature });
  return toHex(secp256k1.Point.fromBytes(hexToBytes(uncompressed)).toBytes(true));
};

/** The Ethereum address of a compressed key, to check it against the Airnode address independently. */
export const addressOf = (compressed: Hex) =>
  publicKeyToAddress(toHex(secp256k1.Point.fromBytes(hexToBytes(compressed)).toBytes(false)));

/** The data the Airnode signs for each projection, with keys in code point order, as the validator rebuilds it. */
export const projectedData = (scheduled: string, status: string, actual?: string) =>
  actual === undefined
    ? `{"scheduled":"${scheduled}","status":"${status}"}`
    : `{"actual":"${actual}","scheduled":"${scheduled}","status":"${status}"}`;

export const messageHash = (requestHash: Hex, timestamp: bigint, data: string): Uint8Array => {
  const inner = keccak256(concat([requestHash, toHex(timestamp, { size: 32 }), toHex(data)]));
  return hexToBytes(keccak256(concat([ETH_PREFIX, inner])));
};

/** verifyEcdsaSecp256k1Signature(pubkey, message, signature): no prehash, low-s only. */
export const plutusVerify = (pubkey: Hex, message: Uint8Array, signature: Hex) =>
  secp256k1.verify(hexToBytes(signature).slice(0, 64), message, hexToBytes(pubkey), { prehash: false, lowS: true, format: 'compact' });

/** Minutes since 1970-01-01 for "YYYY-MM-DD HH:MMZ" (days_from_civil, as in the validator). */
export const minutesOf = (s: string) => {
  const m = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})Z$/.exec(s);
  if (!m) throw new Error(`bad time ${s}`);
  const [y0, mo, d, h, mi] = m.slice(1).map(Number) as [number, number, number, number, number];
  const y = mo <= 2 ? y0 - 1 : y0;
  const era = Math.floor(y / 400);
  const yoe = y - era * 400;
  const doy = Math.floor((153 * (mo + (mo > 2 ? -3 : 9)) + 2) / 5) + d - 1;
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy;
  const days = era * 146097 + doe - 719468;
  return days * 1440 + h * 60 + mi;
};

export type Payout = 'full' | 'half' | 'none';
/** The validator's decision: same thresholds as FlightDelayCover (120 / 180 minutes). */
export const payoutOf = (status: string, scheduled: string, actual?: string): Payout | 'not-final' => {
  if (status === 'Canceled') return 'full';
  if (status !== 'Arrived' || actual === undefined) return 'not-final';
  const delay = Math.max(0, minutesOf(actual) - minutesOf(scheduled));
  return delay >= 180 ? 'full' : delay >= 120 ? 'half' : 'none';
};
