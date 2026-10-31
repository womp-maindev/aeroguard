// Local end-to-end rehearsal on anvil (chain id 84532 so the Base Sepolia client works unchanged).
//   anvil --chain-id 84532 &   then:   npm run rehearse
// Deploys MockUSD + FlightDelayCover (airnode = local FIXTURE signer), buys 5 policies with signed purchase proofs,
// runs the 4 tamper attacks + valid against the deployed bytecode, runs the keeper (fixture mode), then 3 days later
// checks that the keeper expires a private policy it must never look up. Exits 1 on any mismatch (CI runs it).
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createWalletClient, createPublicClient, http, type Hex, keccak256, parseAbi, toHex } from 'viem';
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

// `anvil &` may still be starting: wait up to 10 s for it
for (let i = 0; ; i++) {
  try {
    await p.getChainId();
    break;
  } catch (e) {
    if (i === 20) throw new Error(`no anvil on ${RPC}: start it with \`anvil --chain-id 84532 &\``);
    await new Promise((r) => setTimeout(r, 500));
  }
}

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
process.env.KEEPER_STATE_FILE = join(mkdtempSync(join(tmpdir(), 'aeroguard-rehearse-')), 'keeper-state.json');
console.log('deployed MockUSD', usd, 'cover', cover);

// The scenario is written for BASE_DAY. anvil starts at the wall clock and time can only move forward, so once
// BASE_DAY 06:00Z has passed, the whole day (fixtures, purchases, outcomes, expiry) moves forward by whole days.
const BASE_DAY = '2026-10-31';
const DAY_MS = 86_400_000;
const chainNow = Number((await p.getBlock()).timestamp) * 1000;
const baseStart = Date.parse(`${BASE_DAY}T06:00:00Z`);
const shift = chainNow < baseStart ? 0 : (Math.floor((chainNow - baseStart) / DAY_MS) + 1) * DAY_MS;
const shifted = (iso: string) => new Date(Date.parse(iso) + shift).toISOString().replace('.000Z', 'Z');
const DAY = shifted(`${BASE_DAY}T00:00:00Z`).slice(0, 10);
const fixtures = JSON.parse(readFileSync(new URL('../fixtures/flights.json', import.meta.url), 'utf8')) as Record<string, Record<string, string>>;
const moved = Object.fromEntries(
  Object.entries(fixtures).map(([k, v]) => [
    k.replace(BASE_DAY, DAY),
    Object.fromEntries(Object.entries(v).map(([f, x]) => [f, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}Z$/.test(x) ? shifted(x.replace(' ', 'T').replace('Z', ':00Z')).slice(0, 16).replace('T', ' ') + 'Z' : x])),
  ]),
);
process.env.FIXTURE_FLIGHTS = join(mkdtempSync(join(tmpdir(), 'aeroguard-fixtures-')), 'flights.json');
writeFileSync(process.env.FIXTURE_FLIGHTS, JSON.stringify(moved, null, 2));
if (shift) console.log(`scenario day ${DAY} (${BASE_DAY} is already past on this chain)`);

const { cover: buyCover, keeperTick, log: keeperLog } = await import('./keeper.ts');
const { tamper } = await import('./cli.ts');
const holder = '0x000000000000000000000000000000000000bEEF' as Hex;
const at = async (iso: string) => {
  const t = Date.parse(iso);
  await p.request({ method: 'evm_setNextBlockTimestamp' as never, params: [t / 1000] as never });
  await p.request({ method: 'evm_mine' as never, params: [] as never });
  Date.now = () => t + 30_000; // fixtures are signed "now"; keep wall clock = chain clock
};
// 1) PURCHASE PHASE — 06:00Z, every flight still pre-departure; the contract checks a signed status proof
await at(shifted('2026-10-31T06:00:00Z'));
const ids: Record<string, bigint> = {};
for (const f of ['LH1234', 'LH2002', 'BA117', 'KL1395', 'LH1234']) {
  const r = await buyCover({ flight: f, date: DAY, holder, coverage: 2_000_000n });
  ids[f] = r.policyId;
  console.log('bought', f, 'policy', r.policyId, 'scheduled', r.scheduled);
}
// a private policy (commit–reveal, no flight stored): the keeper must never pay for a lookup on it, and must expire it
// once the settlement window has passed without its holder revealing it
const PRIVATE_ID = 6n;
const privateAbi = parseAbi(['function buyPrivatePolicy(bytes32 commitment, uint128 coverage, address holder, bytes32 cardanoJobRef, uint64 scheduledArrival) returns (uint256)']);
await p.waitForTransactionReceipt({
  hash: await w.writeContract({ address: cover, abi: privateAbi, functionName: 'buyPrivatePolicy', args: [keccak256(toHex('rehearsal: private policy')), 2_000_000n, holder, `0x${'0'.repeat(64)}`, BigInt(Date.parse(shifted('2026-10-31T20:00:00Z')) / 1000)] }),
});
console.log('bought private policy', PRIVATE_ID);
// buying a flight that already left must fail on-chain too
// 2) OUTCOME PHASE — 22:00Z, flights landed / cancelled
await at(shifted('2026-10-31T22:00:00Z'));
try { await buyCover({ flight: 'LH1234', date: DAY, holder }); } catch (e) { console.log('late purchase rejected:', String((e as Error).message).slice(0, 90)); }
// 3) CHECKS — the rehearsal fails (exit 1) if any of these is wrong, so CI can run it
const problems: string[] = [];
const expectRevert: Record<string, string> = { edit: 'NotSignedByAirnode', wrongreq: 'WrongRequest', wrongsigner: 'NotSignedByAirnode', stale: 'Stale' };
for (const m of ['edit', 'wrongreq', 'wrongsigner', 'stale', 'valid']) {
  const r = (await tamper(ids.LH1234!, m)) as { accepted: boolean; reason?: string };
  console.log('tamper', m.padEnd(11), JSON.stringify(r, (_, v) => (typeof v === 'bigint' ? String(v) : v)));
  if (m === 'valid' ? !r.accepted : r.accepted || !r.reason?.startsWith(expectRevert[m]!)) problems.push(`tamper ${m}: ${r.reason ?? 'accepted'}`);
}
await keeperTick();
const status = parseAbi(['function policy(uint256) view returns ((address,uint64,uint32,uint8,uint128,uint128,bytes32,bytes32,bytes32,string,string))', 'function reserved() view returns (uint256)']);
const names = ['None', 'Active', 'PaidHalf', 'PaidFull', 'ClosedNoPayout', 'Expired'];
const expected = ['PaidFull', 'PaidHalf', 'ClosedNoPayout', 'PaidFull', 'PaidFull']; // LH1234 3h15 late · LH2002 2h15 · BA117 10 min · KL1395 cancelled · LH1234
const statusOf = async (id: bigint) => names[(await p.readContract({ address: cover, abi: status, functionName: 'policy', args: [id] }))[3]];
for (const [i, want] of expected.entries()) {
  const got = await statusOf(BigInt(i + 1));
  if (got !== want) problems.push(`policy #${i + 1}: ${got}, expected ${want}`);
}
const balance = Number(await p.readContract({ address: usd, abi: erc, functionName: 'balanceOf', args: [holder] })) / 1e6;
console.log('holder balance', balance, 'aUSD');
if (balance !== 7) problems.push(`holder balance ${balance} aUSD, expected 7 (2 + 1 + 0 + 2 + 2)`);
if ((await statusOf(PRIVATE_ID)) !== 'Active') problems.push(`private policy: ${await statusOf(PRIVATE_ID)} before the window ended`);
if (keeperLog.some((l) => l.msg.includes(`policy #${PRIVATE_ID}`))) problems.push('keeper touched the private policy');
// 4) EXPIRY — 3 days on, the private policy was never revealed: the keeper expires it (gas only), capital is released
await at(shifted('2026-11-04T00:00:00Z'));
await keeperTick();
if ((await statusOf(PRIVATE_ID)) !== 'Expired') problems.push(`private policy: ${await statusOf(PRIVATE_ID)} after the window, expected Expired`);
const reserved = await p.readContract({ address: cover, abi: status, functionName: 'reserved' });
if (reserved !== 0n) problems.push(`reserved ${reserved} after every policy closed, expected 0`);
if (problems.length) {
  console.error(`REHEARSAL FAILED:\n  ${problems.join('\n  ')}`);
  process.exit(1);
}
console.log('REHEARSAL OK: 4 forgeries rejected, 5 policies settled as expected, private policy untouched then expired');
