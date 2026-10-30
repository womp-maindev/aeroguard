// Local end-to-end rehearsal on anvil (chain id 84532 so the Base Sepolia client works unchanged).
//   anvil --chain-id 84532 &   then:   npm run rehearse
// Deploys MockUSD + FlightDelayCover (airnode = local FIXTURE signer), buys 5 policies with signed purchase proofs,
// runs the keeper once (fixture mode), then runs the 4 tamper attacks + valid against the deployed bytecode.
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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
// 3) CHECKS — the rehearsal fails (exit 1) if any of these is wrong, so CI can run it
const problems: string[] = [];
const expectRevert: Record<string, string> = { edit: 'NotSignedByAirnode', wrongreq: 'WrongRequest', wrongsigner: 'NotSignedByAirnode', stale: 'Stale' };
for (const m of ['edit', 'wrongreq', 'wrongsigner', 'stale', 'valid']) {
  const r = (await tamper(ids.LH1234!, m)) as { accepted: boolean; reason?: string };
  console.log('tamper', m.padEnd(11), JSON.stringify(r, (_, v) => (typeof v === 'bigint' ? String(v) : v)));
  if (m === 'valid' ? !r.accepted : r.accepted || !r.reason?.startsWith(expectRevert[m]!)) problems.push(`tamper ${m}: ${r.reason ?? 'accepted'}`);
}
await keeperTick();
const status = parseAbi(['function policy(uint256) view returns ((address,uint64,uint32,uint8,uint128,uint128,bytes32,bytes32,bytes32,string,string))']);
const expected = ['PaidFull', 'PaidHalf', 'ClosedNoPayout', 'PaidFull', 'PaidFull']; // LH1234 3h15 late · LH2002 2h15 · BA117 10 min · KL1395 cancelled · LH1234
const names = ['None', 'Active', 'PaidHalf', 'PaidFull', 'ClosedNoPayout', 'Expired'];
for (const [i, want] of expected.entries()) {
  const got = names[(await p.readContract({ address: cover, abi: status, functionName: 'policy', args: [BigInt(i + 1)] }))[3]];
  if (got !== want) problems.push(`policy #${i + 1}: ${got}, expected ${want}`);
}
const balance = Number(await p.readContract({ address: usd, abi: erc, functionName: 'balanceOf', args: [holder] })) / 1e6;
console.log('holder balance', balance, 'aUSD');
if (balance !== 7) problems.push(`holder balance ${balance} aUSD, expected 7 (2 + 1 + 0 + 2 + 2)`);
if (problems.length) {
  console.error(`REHEARSAL FAILED:\n  ${problems.join('\n  ')}`);
  process.exit(1);
}
console.log('REHEARSAL OK: 4 forgeries rejected, 5 policies settled as expected');
