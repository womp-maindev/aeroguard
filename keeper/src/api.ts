// HTTP API for the dashboard and integrations. PORT=8787 by default.
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import type { Hex } from 'viem';
import { cover, describe, log, runKeeper, verdict } from './keeper.ts';
import { allPolicies, coverAddress, isLocalRpc, networkName, STATUS } from './chain.ts';
import { spendLog } from './flight.ts';
import { tamper } from './cli.ts';

const json = (res: import('node:http').ServerResponse, code: number, body: unknown) => {
  res.writeHead(code, { 'content-type': 'application/json', 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' });
  res.end(JSON.stringify(body, (_, v) => (typeof v === 'bigint' ? v.toString() : v)));
};
const body = async (req: import('node:http').IncomingMessage) => {
  let s = '';
  for await (const c of req) s += c;
  return s ? JSON.parse(s) : {};
};

createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://x');
  try {
    if (req.method === 'OPTIONS') return json(res, 204, {});
    if (url.pathname === '/' || url.pathname === '/index.html') {
      res.writeHead(200, { 'content-type': 'text/html' });
      return res.end(readFileSync(new URL('../../web/index.html', import.meta.url)));
    }
    if (url.pathname === '/health')
      return json(res, 200, { ok: true, contract: coverAddress(), network: networkName(), explorer: isLocalRpc() ? null : 'https://sepolia.basescan.org' });
    if (url.pathname === '/policies') return json(res, 200, (await allPolicies()).map((p) => ({ ...p, statusName: STATUS[p.status] })));
    if (url.pathname === '/log') return json(res, 200, { log, spend: spendLog });
    if (url.pathname === '/verdict') {
      const v = await verdict(url.searchParams.get('flight')!, url.searchParams.get('date')!);
      return json(res, 200, { summary: describe(v.verdict), ...v });
    }
    if (url.pathname === '/cover' && req.method === 'POST') {
      const b = await body(req);
      return json(res, 200, await cover({ flight: b.flight, date: b.date, holder: b.holder as Hex, coverage: b.coverage ? BigInt(Math.round(b.coverage * 1e6)) : undefined, orderId: b.orderId }));
    }
    if (url.pathname === '/tamper' && req.method === 'POST') {
      const b = await body(req);
      return json(res, 200, await tamper(BigInt(b.policyId), b.mode, b.response));
    }
    json(res, 404, { error: 'not found' });
  } catch (e) {
    json(res, 500, { error: String(e instanceof Error ? e.message : e).slice(0, 500) });
  }
}).listen(Number(process.env.PORT ?? 8787), () => console.log(`AeroGuard API on :${process.env.PORT ?? 8787}`));

// Opt-in: the live policies already have a keeper (GitHub Actions), and a second one would spend the shared quota.
if (process.env.KEEPER === 'on') runKeeper(Number(process.env.KEEPER_EVERY ?? 60));
