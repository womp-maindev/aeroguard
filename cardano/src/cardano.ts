// Shared Cardano preprod settings for the server, the buyer and the wallet helper.
import { toClientCardanoSigner } from '@x402/cardano';
import { ExactCardanoScheme } from '@x402/cardano/exact/client';
import { wrapFetchWithPayment, x402Client } from '@x402/fetch';

export const NETWORK = 'cardano:preprod';
export const BLOCKFROST_URL = process.env.BLOCKFROST_BASE_URL || 'https://cardano-preprod.blockfrost.io/api/v0';
export const PRICE_LOVELACE = process.env.PRICE_LOVELACE || '2000000';
export const txLink = (hash: string) => `https://preprod.cardanoscan.io/transaction/${hash}`;

export const env = (name: string) => {
  const v = process.env[name]?.trim();
  if (!v) throw new Error(`Set ${name} in cardano/.env (run: npm run wallets)`);
  return v;
};

export const blockfrost = (projectId = env('BLOCKFROST_PROJECT_ID')) => ({ baseUrl: BLOCKFROST_URL, projectId });

// The reference signer derives the address offline; the provider is only used when it pays.
export const walletFor = (mnemonic: string, provider = { baseUrl: BLOCKFROST_URL, projectId: 'unused' }) =>
  toClientCardanoSigner({ mnemonic, network: NETWORK, provider: { blockfrost: provider } });

export const sellerAddress = () => process.env.SELLER_ADDRESS?.trim() || walletFor(env('SELLER_MNEMONIC')).getAddress();

// An agent's wallet with a hard cap: it pays at most MAX_LOVELACE_PER_REQUEST in tADA per request, nothing else.
export const payingFetch = (wallet: ReturnType<typeof walletFor>) =>
  wrapFetchWithPayment(fetch, x402Client.fromConfig({
    schemes: [{ network: NETWORK, client: new ExactCardanoScheme(wallet) }],
    spendControls: { allowedAssets: [{ network: NETWORK, asset: 'lovelace', maxAmountPerPayment: process.env.MAX_LOVELACE_PER_REQUEST || '5000000' }] },
  }));
