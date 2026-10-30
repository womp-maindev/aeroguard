import assert from 'node:assert/strict';
import { test } from 'node:test';
import { toCBORHex, fromCBORHex } from '@evolution-sdk/evolution/TransactionMetadatum';
import { recoverSigner } from '../../keeper/src/airnode-v2.ts';
import { anchorSale, buildAnchorMetadata, readAnchorProof } from './anchor.ts';
import { walletFor } from './cardano.ts';
import { fakeBlockfrost, SELLER } from './fixture.test-util.ts';
import { buildVerdict } from './verdict.ts';

const PAY_TX = 'f'.repeat(64);

test('anchor metadata round-trips through CBOR into the exact proof a contract verifies', async () => {
  const v = (await buildVerdict('IB1314', '2026-10-30'))!;
  const { message, proof } = buildAnchorMetadata(v, PAY_TX);
  for (const m of [message, proof]) {
    for (const value of [...m.values()].flat()) {
      if (typeof value === 'string' || value instanceof Uint8Array) assert.ok(Buffer.from(value).length <= 64);
    }
  }
  const decoded = fromCBORHex(toCBORHex(proof)) as Map<never, never>;
  const read = readAnchorProof(decoded);
  assert.deepEqual(read, { ...v.evidence, airnode: v.evidence.airnode.toLowerCase() });
  assert.equal(await recoverSigner(read as never), '0x83FE2E8F24E66520B1902C3507De4F471248f2Ec');
});

test('the seller signs and submits an anchor transaction carrying the proof', async (t) => {
  const { state, provider } = await fakeBlockfrost(t, [walletFor(SELLER).getAddress()]);
  const sale = { at: '', tx: PAY_TX, network: 'cardano:preprod', flight: 'IB1314', date: '2026-10-30', kind: 'status', requestHash: '', amount: '1000000', asset: 'lovelace' };
  const { anchorTx } = await anchorSale(sale, provider, SELLER);
  assert.equal(state.submitted.length, 1, JSON.stringify(state.unhandled));
  assert.equal(anchorTx, state.submitted[0]!.hash);
  const bytes = state.submitted[0]!.bytes;
  assert.ok(bytes.includes(Buffer.from('782dcb07ea17581332987058650693af56cf1150a2734228ac3dc8347840c54c', 'hex')));
  assert.ok(bytes.includes(Buffer.from(PAY_TX, 'hex')));
});
