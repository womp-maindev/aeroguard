// After a sale, the seller writes the sold verdict into a Cardano transaction's metadata, so anyone can find the
// Airnode-signed evidence on Cardano itself, next to the payment that bought it. Enable with ANCHOR=true.
import { Assets, Client, preprod, TransactionHash } from '@evolution-sdk/evolution';
import type { TransactionMetadatum } from '@evolution-sdk/evolution/TransactionMetadatum';
import { toBytes } from 'viem';
import { blockfrost, env } from './cardano.ts';
import type { Sale } from './payments.ts';
import { buildVerdict, EVIDENCE_DIRS } from './verdict.ts';

// CIP-20 message for explorers, plus our own label carrying the proof as bytes.
export const MESSAGE_LABEL = 674n;
export const PROOF_LABEL = 8402n;

// Metadata strings and byte strings are limited to 64 bytes each, so longer values become lists of chunks.
const chunks = <T extends string | Uint8Array>(v: T, size = 64): T[] => {
  const out: T[] = [];
  for (let i = 0; i < v.length; i += size) out.push(v.slice(i, i + size) as T);
  return out;
};
const textChunks = (s: string) => {
  const bytes = Buffer.from(s, 'utf8');
  // Split on bytes, never inside a UTF-8 character (the data is ASCII JSON in practice).
  return chunks(new Uint8Array(bytes)).map((b) => Buffer.from(b).toString('utf8'));
};

export const buildAnchorMetadata = (v: NonNullable<Awaited<ReturnType<typeof buildVerdict>>>, paymentTx: string) => {
  const { evidence, verdict } = v;
  const summary = `AeroGuard ${v.flight} ${v.date}: ${verdict.status}${verdict.delayMinutes !== undefined ? ` +${verdict.delayMinutes}min` : ''}`;
  const message = new Map<TransactionMetadatum, TransactionMetadatum>([
    ['msg', [...textChunks(summary), ...textChunks(`paid via x402 in ${paymentTx}`)]],
  ]);
  const proof = new Map<TransactionMetadatum, TransactionMetadatum>([
    ['v', 1n],
    ['flight', v.flight],
    ['date', v.date],
    ['kind', v.kind],
    ['airnode', toBytes(evidence.airnode)],
    ['requestHash', toBytes(evidence.requestHash)],
    ['timestamp', BigInt(evidence.timestamp)],
    ['data', textChunks(evidence.data)],
    ['signature', chunks(toBytes(evidence.signature))],
    ['paymentTx', Buffer.from(paymentTx, 'hex')],
  ]);
  return { message, proof };
};

/** Reassembles the five fields a contract needs from the proof label, as a verifier reading Cardano would. */
export const readAnchorProof = (proof: Map<TransactionMetadatum, TransactionMetadatum>) => {
  const hex = (b: TransactionMetadatum) => `0x${Buffer.from(b as Uint8Array).toString('hex')}`;
  return {
    airnode: hex(proof.get('airnode')!),
    requestHash: hex(proof.get('requestHash')!),
    timestamp: String(proof.get('timestamp')),
    data: (proof.get('data') as string[]).join(''),
    signature: `0x${(proof.get('signature') as Uint8Array[]).map((b) => Buffer.from(b).toString('hex')).join('')}`,
  };
};

export const anchorSale = async (sale: Sale, provider = blockfrost(), mnemonic = env('SELLER_MNEMONIC'), dirs = EVIDENCE_DIRS): Promise<Partial<Sale>> => {
  const verdict = await buildVerdict(sale.flight, sale.date, dirs);
  if (!verdict) throw new Error(`No evidence to anchor for ${sale.flight} ${sale.date}`);
  const { message, proof } = buildAnchorMetadata(verdict, sale.tx);
  const seller = Client.make(preprod).withBlockfrost(provider).withSeed({ mnemonic });
  const address = await seller.address();
  // A minimal self-payment carries the metadata; the seller pays only the fee out of what it just earned.
  const signed = await seller.newTx()
    .payToAddress({ address, assets: Assets.fromLovelace(1_000_000n) })
    .attachMetadata({ label: MESSAGE_LABEL, metadata: message })
    .attachMetadata({ label: PROOF_LABEL, metadata: proof })
    .build();
  const hash = await signed.signAndSubmit();
  const anchorTx = TransactionHash.toHex(hash);
  console.log(`[anchor] ${sale.flight} ${sale.date} -> ${anchorTx}`);
  return { anchorTx };
};
