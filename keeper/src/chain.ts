import {
  BaseError,
  ContractFunctionRevertedError,
  createPublicClient,
  createWalletClient,
  type Hex,
  http,
  keccak256,
  parseAbi,
  parseEventLogs,
  toHex,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { baseSepolia } from 'viem/chains';
import type { SignedResponse } from './airnode-v2.ts';

export const coverAbi = parseAbi([
  'function buyPolicy(string flight, string date, uint128 coverage, address holder, bytes32 cardanoJobRef, uint256 timestamp, bytes data, bytes signature) returns (uint256)',
  'function minLeadTime() view returns (uint32)',
  'function settle(uint256 id, bytes32 requestHash, uint256 timestamp, bytes data, bytes signature)',
  'function expire(uint256 id)',
  'function fundPool(uint256 amount)',
  'function quote(uint128 coverage) view returns (uint128)',
  'function token() view returns (address)',
  'function nextId() view returns (uint256)',
  'function reserved() view returns (uint256)',
  'function freeCapital() view returns (uint256)',
  'function requestHashFor(string flight, string date, bool arrival) view returns (bytes32)',
  'function policy(uint256 id) view returns ((address holder, uint64 scheduledArrival, uint32 maxAge, uint8 status, uint128 premium, uint128 coverage, bytes32 arrivalRequestHash, bytes32 statusRequestHash, bytes32 cardanoJobRef, string flight, string date))',
  'event PolicyBought(uint256 indexed id, address indexed holder, string flight, string date, uint256 premium, uint256 coverage, bytes32 arrivalRequestHash, bytes32 statusRequestHash, bytes32 cardanoJobRef)',
  'event Settled(uint256 indexed id, uint8 status, uint256 delayMinutes, bool cancelled, uint256 payout, bytes32 responseId)',
  'event Expired(uint256 indexed id)',
  'error WrongRequest(bytes32 got)',
  'error Stale(uint256 timestamp)',
  'error FromTheFuture(uint256 timestamp)',
  'error ObservedTooEarly(uint256 signedAt, uint256 observedAt)',
  'error NotFinal(string status)',
  'error NotActive(uint256 id)',
  'error ResponseReused(bytes32 responseId)',
  'error Insolvent(uint256 needed, uint256 free)',
  'error BadFlight()',
  'error BadDate()',
  'error BadCoverage()',
  'error WindowOpen(uint256 until)',
  'error NotBuyable(string status)',
  'error TooCloseToArrival(uint256 scheduled, uint256 earliestAllowed)',
  'error ScheduleMismatch(uint256 signedScheduled, uint256 storedScheduled)',
  'error PrivatePolicy(uint256 id)',
  'error NotSignedByAirnode(address signer)',
  'error ECDSAInvalidSignature()',
  'error ECDSAInvalidSignatureLength(uint256 length)',
  'error ECDSAInvalidSignatureS(bytes32 s)',
]);
export const erc20Abi = parseAbi([
  'function approve(address, uint256) returns (bool)',
  'function allowance(address, address) view returns (uint256)',
  'function balanceOf(address) view returns (uint256)',
]);

export const STATUS = ['None', 'Active', 'PaidHalf', 'PaidFull', 'ClosedNoPayout', 'Expired'] as const;

const env = (k: string) => {
  const v = process.env[k];
  if (!v) throw new Error(`Set ${k} in .env`);
  return v;
};

export const rpc = () => process.env.BASE_SEPOLIA_RPC ?? 'https://sepolia.base.org';
export const coverAddress = () => env('FLIGHT_COVER_ADDRESS') as Hex;
export const publicClient = () => createPublicClient({ chain: baseSepolia, transport: http(rpc()) });
export const walletClient = () =>
  createWalletClient({ chain: baseSepolia, transport: http(rpc()), account: privateKeyToAccount((process.env.KEEPER_PK || env('AGENT_PK')) as Hex) });

/** The anvil rehearsal also uses chain id 84532, so only the RPC tells it apart from Base Sepolia. */
export const isLocalRpc = () => /127\.0\.0\.1|localhost/.test(rpc());
export const networkName = () => (isLocalRpc() ? 'Local anvil' : 'Base Sepolia');
// a local chain has no explorer: label its txs instead of linking to Basescan
export const explorerTx = (h: string) => (isLocalRpc() ? `local tx ${h}` : `https://sepolia.basescan.org/tx/${h}`);

/** Turns viem's huge revert into "Stale(1793...)" */
export const revertReason = (e: unknown): string => {
  const r = e instanceof BaseError && e.walk((c) => c instanceof ContractFunctionRevertedError);
  if (r instanceof ContractFunctionRevertedError && r.data) return `${r.data.errorName}(${(r.data.args ?? []).join(', ')})`;
  return e instanceof BaseError ? e.shortMessage : String(e);
};

export const orderRef = (orderId: string): Hex => (orderId ? keccak256(toHex(orderId)) : `0x${'0'.repeat(64)}`);

export const ensureAllowance = async (amount: bigint) => {
  const w = walletClient();
  const p = publicClient();
  const token = await p.readContract({ address: coverAddress(), abi: coverAbi, functionName: 'token' });
  const a = await p.readContract({ address: token, abi: erc20Abi, functionName: 'allowance', args: [w.account.address, coverAddress()] });
  if (a >= amount) return;
  const h = await w.writeContract({ address: token, abi: erc20Abi, functionName: 'approve', args: [coverAddress(), 2n ** 255n] });
  await p.waitForTransactionReceipt({ hash: h });
};

/** Purchase needs a fresh (≤15 min) signed STATUS response proving the flight hasn't departed yet. */
export const buyPolicy = async (a: {
  flight: string;
  date: string;
  coverage: bigint;
  holder: Hex;
  orderId?: string;
  proof: SignedResponse;
}) => {
  const p = publicClient();
  const premium = await p.readContract({ address: coverAddress(), abi: coverAbi, functionName: 'quote', args: [a.coverage] });
  await ensureAllowance(premium);
  const hash = await walletClient().writeContract({
    address: coverAddress(),
    abi: coverAbi,
    functionName: 'buyPolicy',
    args: [a.flight, a.date, a.coverage, a.holder, orderRef(a.orderId ?? ''), BigInt(a.proof.timestamp), toHex(a.proof.data), a.proof.signature],
  });
  const rc = await p.waitForTransactionReceipt({ hash });
  const [ev] = parseEventLogs({ abi: coverAbi, logs: rc.logs, eventName: 'PolicyBought' });
  if (!ev) throw new Error("no PolicyBought event");
  return { policyId: ev.args.id, txHash: hash, premium };
};

export const settle = async (id: bigint, r: SignedResponse) => {
  const p = publicClient();
  const args = [id, r.requestHash, BigInt(r.timestamp), toHex(r.data), r.signature] as const;
  // simulate first: a reverting response costs nothing and gives a clean reason
  await p.simulateContract({ address: coverAddress(), abi: coverAbi, functionName: 'settle', args, account: walletClient().account });
  const hash = await walletClient().writeContract({ address: coverAddress(), abi: coverAbi, functionName: 'settle', args });
  const rc = await p.waitForTransactionReceipt({ hash });
  const [ev] = parseEventLogs({ abi: coverAbi, logs: rc.logs, eventName: 'Settled' });
  return { txHash: hash, payout: ev?.args.payout ?? 0n, status: STATUS[ev?.args.status ?? 0], delayMinutes: ev?.args.delayMinutes };
};

/** Everything a keeper needs to stay solvent: gas, x402 money, pool capital. All amounts in base units. */
export const balances = async () => {
  const p = publicClient();
  const keeper = walletClient().account.address;
  const token = await p.readContract({ address: coverAddress(), abi: coverAbi, functionName: 'token' });
  const aUsd = (a: Hex) => p.readContract({ address: token, abi: erc20Abi, functionName: 'balanceOf', args: [a] });
  const read = (functionName: 'reserved' | 'freeCapital') => p.readContract({ address: coverAddress(), abi: coverAbi, functionName });
  const [keeperEth, keeperAusd, pool, reserved, free] = await Promise.all([
    p.getBalance({ address: keeper }),
    aUsd(keeper),
    aUsd(coverAddress()),
    read('reserved'),
    read('freeCapital'),
  ]);
  return { keeper, keeperEth, keeperAusd, pool, reserved, free };
};

/** settle measured at ≤ 159k gas (contracts/README gas table); 200k leaves room for a longer signed payload */
export const SETTLE_GAS = 200_000n;
/** ETH a keeper needs for `n` settles at the current fee (maxFeePerGas, the most a tx can be charged per gas). */
export const settleCost = async (n: number) => {
  const { maxFeePerGas } = await publicClient().estimateFeesPerGas();
  return { maxFeePerGas, cost: BigInt(n) * SETTLE_GAS * maxFeePerGas };
};

export const getPolicy = (id: bigint) =>
  publicClient().readContract({ address: coverAddress(), abi: coverAbi, functionName: 'policy', args: [id] });

export const allPolicies = async () => {
  const n = await publicClient().readContract({ address: coverAddress(), abi: coverAbi, functionName: 'nextId' });
  const out = [];
  for (let i = 1n; i < n; i++) out.push({ id: i, ...(await getPolicy(i)) });
  return out;
};
