// pnpm cli <command>   — see README "Commands"
import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { decodeFunctionData, formatEther, formatGwei, type Hex, hexToString, keccak256, toHex } from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import type { SignedResponse } from './airnode-v2.ts';
import { cover, describe, keeperTick, log, resolveFlight, runKeeper, verdict } from './keeper.ts';
import { allPolicies, balances, coverAbi, explorerTx, getPolicy, publicClient, revertReason, settle, settleCost, STATUS } from './chain.ts';
import { AERODATABOX_AIRNODE, requestHashFor } from './flight.ts';

const [cmd, ...rest] = process.argv.slice(2);
const flag = (n: string) => {
  const i = rest.indexOf(`--${n}`);
  return i >= 0 ? rest[i + 1] : undefined;
};
const need = (n: string) => {
  const v = flag(n);
  if (!v) throw new Error(`--${n} is required`);
  return v;
};

/** Signs like an Airnode v2 (EIP-191 over keccak(requestHash, timestamp, data)) — used to forge with a random key. */
const forgeSign = async (pk: Hex, r: Omit<SignedResponse, 'signature'>) => {
  const { encodePacked } = await import('viem');
  const digest = keccak256(encodePacked(['bytes32', 'uint256', 'bytes'], [r.requestHash, BigInt(r.timestamp), toHex(r.data)]));
  return privateKeyToAccount(pk).signMessage({ message: { raw: digest } });
};

/** The API3 tamper test against the DEPLOYED contract. Judges: pass your own --response file.json. */
export const tamper = async (id: bigint, mode: string, base?: SignedResponse) => {
  const p = await getPolicy(id);
  const real = base ?? (await verdict(p.flight, p.date, 3600)).evidence;
  let r: SignedResponse = { ...real };
  switch (mode) {
    case 'valid':
      break;
    case 'edit': // one value edited, original signature kept
      r.data = r.data.replace(/"actual":"[^"]+"/, '"actual":"2099-01-01 00:00Z"').replace(/"status":"[^"]+"/, '"status":"Canceled"');
      if (r.data === real.data) r.data = r.data.replace('"', ' "');
      break;
    case 'stale': {
      // a GENUINE, correctly signed response that is older than the policy's maxAge (pass it with --response old.json)
      if (process.env.FIXTURE_MODE === 'true' && process.env.FIXTURE_SIGNER_PK) {
        // fixture signer is ours: produce a GENUINELY signed response that is 2h old
        r.timestamp = String(Number(r.timestamp) - 7200);
        r.signature = await forgeSign(process.env.FIXTURE_SIGNER_PK as Hex, r);
        break;
      }
      const age = Math.floor(Date.now() / 1000) - Number(r.timestamp);
      if (age <= Number(p.maxAge))
        return { accepted: false, skipped: `response is only ${age}s old; pass --response with one older than ${p.maxAge}s (e.g. keeper/fixtures/*.json)` };
      break;
    }
    case 'wrongreq': // genuine-looking response for another flight, signed by a random key cannot pass either
      r.requestHash = requestHashFor('LH9999', p.date, 'arrival');
      break;
    case 'wrongsigner': // correct request + data, signed by an attacker key
      r.signature = await forgeSign(generatePrivateKey(), r);
      break;
    default:
      throw new Error('mode: valid | edit | stale | wrongreq | wrongsigner');
  }
  try {
    const res = await settle(id, r);
    return { accepted: true, ...res, link: explorerTx(res.txHash) };
  } catch (e) {
    return { accepted: false, reason: revertReason(e) };
  }
};

const main = async () => {
  switch (cmd) {
    case 'wallet': {
      const pk = generatePrivateKey();
      console.log(`KEEPER_PK=${pk}\n# address: ${privateKeyToAccount(pk).address}`);
      return;
    }
    case 'hash':
      console.log(requestHashFor(need('flight'), need('date'), (flag('kind') as 'arrival' | 'status') ?? 'arrival'));
      return;
    case 'resolve':
      console.log(await resolveFlight(need('flight'), need('date')));
      return;
    case 'verdict': {
      const v = await verdict(need('flight'), need('date'));
      console.log(describe(v.verdict));
      console.log(JSON.stringify(v.evidence, null, 2));
      return;
    }
    case 'buy-batch': {
      // Several real policies in one go: `buy-batch LH411@2026-10-30 UA58@2026-10-30 … --holder 0x… --coverage 0.5`.
      // Each costs one signed status lookup; the contract itself refuses flights already delayed or too close to arrival,
      // so a rejected one is reported and skipped, never retried (the AeroDataBox quota is shared).
      const holder = need('holder') as Hex;
      const coverage = BigInt(Math.round(Number(flag('coverage') ?? '0.5') * 1e6));
      for (const spec of rest.filter((a) => a.includes('@'))) {
        const [flight, date] = spec.split('@') as [string, string];
        try {
          const r = await cover({ flight, date, holder, coverage });
          console.log(`BOUGHT #${r.policyId} ${r.flight} ${date} sched ${r.scheduled} (${r.status}) ${explorerTx(r.txHash)}`);
        } catch (e) {
          console.log(`SKIPPED ${flight} ${date}: ${revertReason(e).slice(0, 160)}`);
        }
      }
      return;
    }
    case 'buy':
      console.log(
        await cover({
          flight: need('flight'),
          date: need('date'),
          holder: need('holder') as Hex,
          coverage: BigInt(Math.round(Number(flag('coverage') ?? '2') * 1e6)),
          orderId: flag('order'),
        }),
      );
      return;
    case 'policies':
      for (const p of await allPolicies()) console.log(`#${p.id} ${p.flight} ${p.date} ${STATUS[p.status]} cover ${Number(p.coverage) / 1e6}`);
      return;
    case 'status': {
      const b = await balances();
      const usd = (v: bigint) => (Number(v) / 1e6).toFixed(2);
      console.log(`keeper ${b.keeper}: ${formatEther(b.keeperEth)} ETH, ${usd(b.keeperAusd)} aUSD`);
      console.log(`pool: ${usd(b.pool)} aUSD, reserved ${usd(b.reserved)}, free ${usd(b.free)}`);
      const policies = await allPolicies();
      const active = policies.filter((p) => p.status === 1).length;
      const { maxFeePerGas, cost } = await settleCost(active);
      const verdict = !active ? 'no active policies' : b.keeperEth >= cost ? `ok, ${(Number(b.keeperEth) / Number(cost)).toFixed(1)}x headroom` : 'NOT ENOUGH, top up';
      console.log(`gas: maxFee ${formatGwei(maxFeePerGas)} gwei, ${active} settles need ≤ ${formatEther(cost)} ETH: ${verdict}`);
      for (const p of policies)
        console.log(`#${p.id} ${p.flight} ${p.date} ${STATUS[p.status]} cover ${usd(p.coverage)} sched ${new Date(Number(p.scheduledArrival) * 1000).toISOString()}`);
      return;
    }
    case 'proof': {
      // The signed purchase proof of a public policy, read back from its buyPolicy calldata, in the
      // contracts/test/fixtures format: `cli proof <buyPolicy tx hash>…` (read-only, no key, no AeroDataBox lookup).
      for (const hash of rest.filter((a) => /^0x[0-9a-fA-F]{64}$/.test(a)) as Hex[]) {
        const tx = await publicClient().getTransaction({ hash });
        const { functionName, args } = decodeFunctionData({ abi: coverAbi, data: tx.input });
        if (functionName !== 'buyPolicy') throw new Error(`${hash} calls ${functionName}, not buyPolicy`);
        const [flight, date, , , , timestamp, data, signature] = args;
        const proof = { flight, date, kind: 'status', airnode: AERODATABOX_AIRNODE, requestHash: requestHashFor(flight, date, 'status'), timestamp: Number(timestamp), data: hexToString(data), signature, purchaseTx: hash };
        console.log(JSON.stringify(proof, null, 2));
      }
      return;
    }
    case 'tick': { // --force: check now, ignoring the 30-min rhythm · --policy N: only that policy
      const only = flag('policy') || process.env.KEEPER_ONLY;
      await keeperTick({ force: rest.includes('--force') || process.env.KEEPER_FORCE === 'true', only: only ? BigInt(only) : undefined });
      // the workflow publishes this pass's log for the dashboard (src/publish.ts)
      if (process.env.KEEPER_RUN_LOG) writeFileSync(process.env.KEEPER_RUN_LOG, JSON.stringify(log, null, 2));
      return;
    }
    case 'keeper':
      await runKeeper(Number(flag('every') ?? 60));
      return;
    case 'tamper': {
      const file = flag('response');
      const base = file ? (JSON.parse(readFileSync(file, 'utf8')) as SignedResponse) : undefined;
      const modes = flag('mode') ? [flag('mode')!] : ['edit', 'stale', 'wrongreq', 'wrongsigner', 'valid'];
      for (const m of modes) console.log(m.padEnd(12), JSON.stringify(await tamper(BigInt(need('policy')), m, base), (_, v) => (typeof v === 'bigint' ? v.toString() : v)));
      return;
    }
    default:
      console.log('commands: wallet | hash | resolve | verdict | buy | buy-batch | policies | status | proof | tick | keeper | tamper');
  }
};

// pathToFileURL, not `file://${argv[1]}`: on Windows the path is C:... and the URL file:///C:/..., so they never matched
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch((e) => (console.error(revertReason(e)), process.exit(1)));
