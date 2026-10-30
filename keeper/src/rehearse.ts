// Local end-to-end rehearsal on anvil (chain id 84532 so the Base Sepolia client works unchanged).
//   anvil --chain-id 84532 &   then:   node src/e2e-local.ts
// Deploys MockUSD + FlightDelayCover (airnode = local FIXTURE signer), buys 5 policies with signed purchase proofs,
// runs the keeper once (fixture mode), then runs the 4 tamper attacks + valid against the deployed bytecode.
import { readFileSync } from 'node:fs';
import { createWalletClient, createPublicClient, http, type Hex, parseAbi } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { baseSepolia } from 'viem/chains';

const RPC = 'http://127.0.0.1:8545';
const DEPLOYER = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80' as Hex; // anvil #0
const FIXTURE_SIGNER = '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d' as Hex; // anvil #1
const art = (p: string) => JSON.parse(readFileSync(new URL(`../../contracts/out/${p}`, import.meta.url), 'utf8'));
const chain = { ...baseSepolia, rpcUrls: { default: { http: [RPC] } } };
const w = createWalletClient({ chain, transport: http(RPC), account: privateKeyToAccount(DEPLOYER) });
const p = createPublicClient({ chain, transport: http(RPC) });
const deploy = async (a: { abi: unknown; bytecode: { object: Hex } }, args: unknown[]) => {
  const hash = await w.deployContract({ abi: a.abi as never, bytecode: a.bytecode.object, args: args as never });
  return (await p.waitForTransactionReceipt({ hash })).contractAddress!;
};

const usdArt = art('FlightDelayCover.t.sol/MockUSD.json');
const usd = await deploy(usdArt, []);
const cover = await deploy(art('FlightDelayCover.sol/FlightDelayCover.json'), [usd, privateKeyToAccount(FIXTURE_SIGNER).address, 800, 3600, 5_000_000n]);
const erc = parseAbi(['function mint(address,uint256)', 'function approve(address,uint256) returns (bool)', 'function balanceOf(address) view returns (uint256)']);
for (const [fn, args] of [['mint', [w.account.address, 1000_000_000n]], ['approve', [cover, 2n ** 255n]]] as const) {
  await p.waitForTransactionReceipt({ hash: await w.writeContract({ address: usd, abi: erc, functionName: fn as never, args: args as never }) });
}
await p.waitForTransactionReceipt({ hash: await w.writeContract({ address: cover, abi: parseAbi(['function fundPool(uint256)']), functionName: 'fundPool', args: [100_000_000n] }) });

process.env.BASE_SEPOLIA_RPC = RPC;
process.env.KEEPER_PK = DEPLOYER;
process.env.FLIGHT_COVER_ADDRESS = cover;
process.env.FIXTURE_MODE = 'true';
process.env.FIXTURE_SIGNER_PK = FIXTURE_SIGNER;
console.log('deployed MockUSD', usd, 'cover', cover);

const { cover: buyCover, keeperTick } = await import('./keeper.ts');
const { tamper } = await import('./cli.ts');
const holder = '0x000000000000000000000000000000000000bEEF' as Hex;
const at = async (iso: string) => {
  const t = Date.parse(iso);
  await p.request({ method: 'evm_setNextBlockTimestamp' as never, params: [t / 1000] as never });
  await p.request({ method: 'evm_mine' as never, params: [] as never });
  Date.now = () => t + 30_000; // fixtures are signed "now"; keep wall clock = chain clock
};
// 1) PURCHASE PHASE — 06:00Z, every flight still pre-departure; the contract checks a signed status proof
await at('2026-10-31T06:00:00Z');
const ids: Record<string, bigint> = {};
for (const f of ['LH1234', 'LH2002', 'BA117', 'KL1395', 'LH1234']) {
  const r = await buyCover({ flight: f, date: '2026-10-31', holder, coverage: 2_000_000n });
  ids[f] = r.policyId;
  console.log('bought', f, 'policy', r.policyId, 'scheduled', r.scheduled);
}
// buying a flight that already left must fail on-chain too
// 2) OUTCOME PHASE — 22:00Z, flights landed / cancelled
await at('2026-10-31T22:00:00Z');
try { await buyCover({ flight: 'LH1234', date: '2026-10-31', holder }); } catch (e) { console.log('late purchase rejected:', String((e as Error).message).slice(0, 90)); }
for (const m of ['edit', 'wrongreq', 'wrongsigner', 'stale', 'valid']) console.log('tamper', m.padEnd(11), JSON.stringify(await tamper(ids.LH1234!, m), (_, v) => (typeof v === 'bigint' ? String(v) : v)));
await keeperTick();
console.log('holder balance', Number(await p.readContract({ address: usd, abi: erc, functionName: 'balanceOf', args: [holder] })) / 1e6, 'aUSD');
