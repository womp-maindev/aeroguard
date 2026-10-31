// Runs the local rehearsal (src/rehearse.ts) from the dashboard: POST /rehearse/run starts a fresh anvil on :8545 and
// the rehearsal, GET /rehearse/log?from=N streams its output, GET /rehearse/status says whether this is enabled.
// Opt-in with REHEARSE=on, for a laptop only: it starts processes. It only answers pages served from localhost, runs one
// fixed script with no input from the request, strips every private key from the script's environment, and never
// touches a chain on :8545 that it did not start itself.
import { type ChildProcess, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const KEEPER_DIR = fileURLToPath(new URL('..', import.meta.url));
const CONTRACTS_DIR = fileURLToPath(new URL('../../contracts', import.meta.url));
const ARTIFACT = join(CONTRACTS_DIR, 'out', 'FlightDelayCover.sol', 'FlightDelayCover.json');
const RPC = 'http://127.0.0.1:8545';
const MAX_LINES = 2000;

interface Run {
  id: number;
  running: boolean;
  ok: boolean | null;
  startedAt: number;
  finishedAt?: number;
  cover?: string;
  lines: { t: number; text: string }[];
}

let run: Run | null = null;
let anvil: ChildProcess | null = null;
let seq = 0;

const enabled = () => process.env.REHEARSE === 'on';

// Foundry's binaries from PATH, or from ~/.foundry/bin when the API was started from a shell that predates the install.
const foundryBin = (name: string) => {
  const local = join(homedir(), '.foundry', 'bin', process.platform === 'win32' ? `${name}.exe` : name);
  return existsSync(local) ? local : name;
};

// The rehearsal runs on a throwaway chain with anvil's public test keys. No real key belongs in its environment.
const cleanEnv = () => {
  const env: NodeJS.ProcessEnv = {};
  for (const [k, v] of Object.entries(process.env)) if (!/(_PK|PRIVATE|SECRET|TOKEN|MNEMONIC)/i.test(k)) env[k] = v;
  return env;
};

const say = (text: string) => {
  if (!run) return;
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    run.lines.push({ t: Date.now(), text: line });
    const cover = line.match(/deployed MockUSD \S+ cover (0x[0-9a-fA-F]{40})/);
    if (cover) run.cover = cover[1];
  }
  if (run.lines.length > MAX_LINES) run.lines.splice(0, run.lines.length - MAX_LINES);
};

const rpcAlive = async () => {
  try {
    const r = await fetch(RPC, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_chainId', params: [] }), signal: AbortSignal.timeout(1000) });
    return r.ok;
  } catch {
    return false;
  }
};

const waitFor = async (check: () => Promise<boolean>, ms: number) => {
  for (const until = Date.now() + ms; Date.now() < until; await new Promise((r) => setTimeout(r, 250))) if (await check()) return true;
  return false;
};

// Runs a command to completion, streaming its output into the run log.
const exec = (cmd: string, args: string[], cwd: string, env = cleanEnv()) =>
  new Promise<number>((resolve) => {
    const child = spawn(cmd, args, { cwd, env, windowsHide: true });
    child.stdout.on('data', (d) => say(String(d)));
    child.stderr.on('data', (d) => say(String(d)));
    child.on('error', (e) => {
      say(`could not start ${cmd}: ${e.message}`);
      resolve(1);
    });
    child.on('close', (code) => resolve(code ?? 1));
  });

const stopAnvil = async () => {
  if (!anvil) return;
  anvil.kill();
  anvil = null;
  await waitFor(async () => !(await rpcAlive()), 5000);
};

async function start() {
  run = { id: ++seq, running: true, ok: null, startedAt: Date.now(), lines: [] };
  const fail = (why: string) => {
    say(`REHEARSAL FAILED: ${why}`);
    run!.ok = false;
  };
  try {
    if (!existsSync(ARTIFACT)) {
      say('$ forge build   (contracts/out is missing)');
      if ((await exec(foundryBin('forge'), ['build'], CONTRACTS_DIR)) !== 0) return fail('forge build failed');
    }
    // A fresh chain every time: the rehearsal sets block times from 06:00 to 3 days later, and time cannot go back.
    await stopAnvil();
    if (await rpcAlive()) return fail(`something else is already serving ${RPC}. Stop it (it is not ours to kill), then run again.`);
    say('$ anvil --chain-id 84532   (a fresh local chain with Base Sepolia\'s chain id)');
    anvil = spawn(foundryBin('anvil'), ['--chain-id', '84532', '--silent'], { env: cleanEnv(), windowsHide: true, stdio: 'ignore' });
    anvil.on('error', (e) => say(`could not start anvil: ${e.message}. Install Foundry (getfoundry.sh) or open a new terminal.`));
    if (!(await waitFor(rpcAlive, 15000))) return fail('anvil did not start');
    say('$ npm run rehearse');
    const code = await exec(process.execPath, ['src/rehearse.ts'], KEEPER_DIR);
    run.ok = code === 0;
    if (code !== 0 && !run.lines.some((l) => l.text.startsWith('REHEARSAL FAILED'))) fail(`rehearse exited with code ${code}`);
  } catch (e) {
    fail(String(e instanceof Error ? e.message : e));
  } finally {
    run.running = false;
    run.finishedAt = Date.now();
  }
}

// Same-machine pages only, so another website open in the browser cannot start processes through this API.
const localOrigin = (req: IncomingMessage) => {
  const origin = req.headers.origin;
  return !origin || /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
};

const status = () => ({
  enabled: enabled(),
  running: !!run?.running,
  id: run?.id ?? null,
  ok: run?.ok ?? null,
  cover: run?.cover ?? null,
  rpc: RPC,
  startedAt: run?.startedAt ?? null,
  finishedAt: run?.finishedAt ?? null,
  lines: run?.lines.length ?? 0,
});

/** Handles /rehearse/*. Returns false for any other path. */
export async function handleRehearse(req: IncomingMessage, res: ServerResponse, url: URL, json: (res: ServerResponse, code: number, body: unknown) => void) {
  if (!url.pathname.startsWith('/rehearse/')) return false;
  if (url.pathname === '/rehearse/status') return json(res, 200, status()), true;
  if (!enabled()) return json(res, 403, { error: 'the local rehearsal is off: start the API with REHEARSE=on' }), true;
  if (!localOrigin(req)) return json(res, 403, { error: 'the rehearsal only runs from a page on localhost' }), true;
  if (url.pathname === '/rehearse/run' && req.method === 'POST') {
    if (run?.running) return json(res, 409, { error: 'a rehearsal is already running', ...status() }), true;
    void start();
    return json(res, 202, status()), true;
  }
  if (url.pathname === '/rehearse/log') {
    const from = Math.max(0, Number(url.searchParams.get('from')) || 0);
    return json(res, 200, { ...status(), from, lines: run ? run.lines.slice(from) : [] }), true;
  }
  return json(res, 404, { error: 'not found' }), true;
}

// Do not leave our anvil running after the API stops.
for (const sig of ['SIGINT', 'SIGTERM'] as const) process.once(sig, () => (anvil?.kill(), process.exit(0)));
process.once('exit', () => anvil?.kill());
