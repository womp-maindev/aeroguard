// Checks everything a real preprod run needs and says how to fix what is missing. `npm run preflight`.
import { walletFor } from './cardano.ts';
import { PRICES } from './server.ts';
import { findEvidence, tierOf } from './verdict.ts';

export interface Check { name: string; ok: boolean; detail: string; fix?: string }

const lovelaceAt = async (baseUrl: string, projectId: string, address: string, f: typeof fetch) => {
  const res = await f(`${baseUrl}/addresses/${address}`, { headers: { project_id: projectId } });
  if (res.status === 404) return 0n; // never funded
  if (!res.ok) throw new Error(`Blockfrost ${res.status}: ${await res.text()}`);
  const body = (await res.json()) as { amount: { unit: string; quantity: string }[] };
  return BigInt(body.amount.find((a) => a.unit === 'lovelace')?.quantity ?? '0');
};

export const preflight = async (env: NodeJS.ProcessEnv, o: { baseUrl: string; flight?: string; date?: string; fetch?: typeof fetch }) => {
  const f = o.fetch ?? fetch;
  const checks: Check[] = [];
  const add = (c: Check) => { checks.push(c); return c.ok; };

  const projectId = env.BLOCKFROST_PROJECT_ID?.trim() ?? '';
  add({ name: 'Blockfrost key', ok: projectId.startsWith('preprod'), detail: projectId ? `${projectId.slice(0, 11)}…` : 'missing',
    fix: 'Create a project for "Cardano preprod" on blockfrost.io and set BLOCKFROST_PROJECT_ID in cardano/.env' });

  let buyer = '';
  try { buyer = walletFor(env.BUYER_MNEMONIC?.trim() ?? '').getAddress(); } catch { /* reported below */ }
  add({ name: 'Buyer wallet', ok: buyer.startsWith('addr_test1'), detail: buyer || 'BUYER_MNEMONIC missing or invalid', fix: 'npm run wallets' });

  let seller = env.SELLER_ADDRESS?.trim() ?? '';
  try { seller ||= walletFor(env.SELLER_MNEMONIC?.trim() ?? '').getAddress(); } catch { /* reported below */ }
  add({ name: 'Seller address', ok: seller.startsWith('addr_test1') && seller !== buyer, detail: seller || 'SELLER_MNEMONIC missing',
    fix: 'npm run wallets (buyer and seller must differ)' });

  const flight = o.flight ?? 'IB1314';
  const date = o.date ?? '2026-10-30';
  const evidence = findEvidence(flight, date);
  add({ name: 'Signed evidence', ok: !!evidence, detail: evidence ? `${flight} ${date} (${evidence.kind})` : `none for ${flight} ${date}`,
    fix: 'Pick a flight listed by GET /flights' });

  if (!checks[0]!.ok) return checks;
  try {
    const res = await f(`${o.baseUrl}/`, { headers: { project_id: projectId } });
    const body = res.ok ? ((await res.json()) as { url?: string }) : undefined;
    if (!add({ name: 'Blockfrost reachable', ok: res.ok, detail: res.ok ? (body?.url ?? 'ok') : `HTTP ${res.status}`,
      fix: res.status === 403 ? 'Key is for another network or invalid' : 'Check network / BLOCKFROST_BASE_URL' })) return checks;
  } catch (e) {
    add({ name: 'Blockfrost reachable', ok: false, detail: String(e), fix: 'Check internet access to cardano-preprod.blockfrost.io' });
    return checks;
  }
  if (buyer) {
    const need = BigInt(PRICES[evidence ? tierOf(evidence.response) : 'final'].lovelace) + 2_000_000n; // price + fee + change headroom
    try {
      const have = await lovelaceAt(o.baseUrl, projectId, buyer, f);
      add({ name: 'Buyer balance', ok: have >= need, detail: `${Number(have) / 1e6} tADA (need ≥ ${Number(need) / 1e6})`,
        fix: `Fund ${buyer} from https://docs.cardano.org/cardano-testnets/tools/faucet (Preprod); wait ~1 min` });
    } catch (e) {
      add({ name: 'Buyer balance', ok: false, detail: String(e), fix: 'Check the Blockfrost key' });
    }
  }
  return checks;
};

export const printChecks = (checks: Check[]) => {
  for (const c of checks) console.log(`${c.ok ? '✅' : '❌'} ${c.name.padEnd(20)} ${c.detail}${c.ok || !c.fix ? '' : `\n   → ${c.fix}`}`);
  return checks.every((c) => c.ok);
};

if (import.meta.filename === process.argv[1]) {
  const { BLOCKFROST_URL } = await import('./cardano.ts');
  process.exit(printChecks(await preflight(process.env, { baseUrl: BLOCKFROST_URL })) ? 0 : 1);
}
