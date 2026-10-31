// Shows the buyer's and seller's preprod balances, so you can see the faucet and the payment land.
import { blockfrost, env, walletFor } from './cardano.ts';

const provider = blockfrost();
for (const [role, name] of [['buyer', 'BUYER_MNEMONIC'], ['seller', 'SELLER_MNEMONIC']] as const) {
  const address = walletFor(env(name)).getAddress();
  const res = await fetch(`${provider.baseUrl}/addresses/${address}`, { headers: { project_id: provider.projectId } });
  const lovelace = res.status === 404 ? '0' : ((await res.json()) as { amount: { unit: string; quantity: string }[] }).amount.find((a) => a.unit === 'lovelace')?.quantity ?? '0';
  console.log(`${role.padEnd(6)} ${(Number(lovelace) / 1e6).toFixed(6)} tADA  ${address}`);
}
