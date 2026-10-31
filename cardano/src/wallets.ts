// Creates cardano/.env with a fresh buyer and seller preprod wallet (never committed), then prints what to fund.
import { fileURLToPath } from 'node:url';
import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import { PrivateKey } from '@evolution-sdk/evolution';
import { walletFor } from './cardano.ts';

const file = fileURLToPath(new URL('../.env', import.meta.url));
const current = existsSync(file) ? readFileSync(file, 'utf8') : '';
const read = (name: string) => current.match(new RegExp(`^${name}="?([^"\\n]*)"?$`, 'm'))?.[1]?.trim();

const lines: string[] = [];
if (!read('BLOCKFROST_PROJECT_ID')) lines.push('BLOCKFROST_PROJECT_ID=');
for (const name of ['BUYER_MNEMONIC', 'SELLER_MNEMONIC']) {
  if (!read(name)) lines.push(`${name}="${PrivateKey.generateMnemonic()}"`);
}
if (lines.length) appendFileSync(file, (current && !current.endsWith('\n') ? '\n' : '') + lines.join('\n') + '\n', { mode: 0o600 });

const env = readFileSync(file, 'utf8');
const get = (name: string) => env.match(new RegExp(`^${name}="?([^"\\n]*)"?$`, 'm'))![1]!;
console.log(`${file}${lines.length ? ' (updated)' : ''}`);
console.log(`buyer  ${walletFor(get('BUYER_MNEMONIC')).getAddress()}   <- fund from https://docs.cardano.org/cardano-testnets/tools/faucet (Preprod)`);
console.log(`seller ${walletFor(get('SELLER_MNEMONIC')).getAddress()}   <- receives the payments, needs no funds`);
if (!get('BLOCKFROST_PROJECT_ID')) console.log('Set BLOCKFROST_PROJECT_ID (a "preprod..." project from https://blockfrost.io)');
