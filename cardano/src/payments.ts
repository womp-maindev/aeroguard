// Application bookkeeping around x402: one transaction buys one operation, failed lookups never declare a payment
// expired, and every settled sale is logged. PaymentOperations and confirmExpiry follow
// cardano-foundation/x402-cardano-demo (server/src/paymentOperations.ts, facilitator/src/settlement.ts).
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { ERR_SETTLEMENT_FAILED, ERR_SETTLEMENT_PENDING, type FacilitatorCardanoSigner, withCardanoProviderTimeout } from '@x402/cardano';
import type { SettleResponse, VerifyResponse } from '@x402/core/types';

/** Idempotency, separate from the facilitator's broadcast deduplication. */
export class PaymentOperations {
  private readonly payments = new Map<string, { operation: string; retainUntil: number; body?: unknown; verification?: { fingerprint: string; result: VerifyResponse } }>();
  private readonly operations = new Map<string, string>();

  claim(transaction: string, operation: string, validUntil: number): string | undefined {
    const now = Date.now();
    for (const [id, record] of this.payments) {
      if (record.retainUntil < now) {
        this.payments.delete(id);
        this.operations.delete(record.operation);
      }
    }
    const prior = this.payments.get(transaction);
    if (prior) return prior.operation === operation ? undefined : 'duplicate_payment_operation';
    if (this.operations.has(operation)) return 'duplicate_payment_operation';
    // An old settled transaction must not become a new purchase after eviction.
    if (validUntil <= now) return 'payment_expired';
    if (this.payments.size >= 4096) return 'payment_operation_capacity';
    this.payments.set(transaction, { operation, retainUntil: validUntil + 24 * 60 * 60_000 });
    this.operations.set(operation, transaction);
  }

  rememberVerification(transaction: string, fingerprint: string, result: VerifyResponse) {
    const record = this.payments.get(transaction);
    if (!record || !result.isValid) throw new Error('Only a claimed, verified payment can be remembered');
    record.verification = { fingerprint, result: structuredClone(result) };
  }

  verified(transaction: string, operation: string, fingerprint: string): VerifyResponse | undefined {
    const record = this.payments.get(transaction);
    if (!record || record.retainUntil < Date.now() || record.operation !== operation || record.verification?.fingerprint !== fingerprint) return;
    return structuredClone(record.verification.result);
  }

  // A resumed request for the same payment gets the same body, not a second one.
  async result<T>(transaction: string, create: () => Promise<T>): Promise<T> {
    const record = this.payments.get(transaction);
    if (!record) throw new Error('Payment has not been verified for an operation');
    record.body ??= await create();
    return record.body as T;
  }
}

/** The SDK can turn a failed lookup into "expired". Require a successful lookup before telling the buyer so. */
export const confirmExpiry = async (result: SettleResponse, signer: FacilitatorCardanoSigner): Promise<SettleResponse> => {
  if (result.success || result.errorReason !== ERR_SETTLEMENT_FAILED || result.extra?.status !== 'expired') return result;
  let errorMessage = 'Settlement evidence changed while checking expiry. Check the same payment again.';
  try {
    const evidence = signer.getTransactionEvidence && await withCardanoProviderTimeout(
      signer.getTransactionEvidence(result.transaction, result.network), 15_000, 'expiry evidence');
    if (evidence?.status === 'unknown') return result;
  } catch {
    errorMessage = 'The transaction lookup is unavailable, so expiry cannot be confirmed. Check the same payment again.';
  }
  return { ...result, success: false, errorReason: ERR_SETTLEMENT_PENDING, errorMessage,
    extra: { ...result.extra, status: 'pending', transactionId: result.transaction } };
};

export interface Sale {
  at: string;
  tx: string;
  network: string;
  flight: string;
  date: string;
  kind: string;
  requestHash: string;
  amount: string;
  asset: string;
  payer?: string;
  anchorTx?: string;
}

/** Append-only log keyed by Cardano payment tx: settled sales (GET /sales) and policy orders (GET /orders/:tx). */
export class TxLog<T extends { tx: string }> {
  private readonly file?: string;
  constructor(file?: string) { this.file = file; }
  private readonly memory: T[] = [];
  has(tx: string) { return this.all().some((s) => s.tx === tx); }
  get(tx: string) { return this.all().find((s) => s.tx === tx); }
  add(entry: T) {
    this.memory.push(entry);
    if (!this.file) return;
    mkdirSync(dirname(this.file), { recursive: true });
    appendFileSync(this.file, JSON.stringify(entry) + '\n');
  }
  update(tx: string, patch: Partial<T>) {
    const entry = this.memory.find((s) => s.tx === tx);
    if (entry) Object.assign(entry, patch);
    if (this.file) appendFileSync(this.file, JSON.stringify({ ...entry, ...patch, tx }) + '\n');
  }
  all(): T[] {
    if (!this.file || !existsSync(this.file)) return this.memory;
    // Later lines for the same tx (an anchor, a bought policy) override earlier ones.
    const byTx = new Map<string, T>();
    for (const line of readFileSync(this.file, 'utf8').split('\n').filter(Boolean)) {
      const s = JSON.parse(line) as T;
      byTx.set(s.tx, { ...byTx.get(s.tx), ...s });
    }
    return [...byTx.values()];
  }
}

export class SalesLog extends TxLog<Sale> {}

/** A FlightDelayCover policy on Base Sepolia, paid for in tADA on Cardano. */
export interface Order {
  at: string;
  tx: string; // the Cardano payment
  orderRef: string; // keccak256("cardano:<tx>"), stored on the policy as cardanoJobRef
  flight: string;
  date: string;
  holder: string;
  coverage: string; // aUSD units
  premium: string; // aUSD units
  amount: string; // what was paid on Cardano
  asset: string;
  status: 'buying' | 'bought' | 'failed';
  policyId?: string;
  policyTx?: string;
  explorer?: string;
  error?: string;
  refundDue?: boolean;
}

export class OrdersLog extends TxLog<Order> {}
