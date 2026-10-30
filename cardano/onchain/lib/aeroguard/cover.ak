//// Spending rule of a flight cover UTxO on Cardano: it holds the cover amount and is spent only by a valid Airnode proof that the
//// flight is final (paying the holder by FlightDelayCover's rule), or by the insurer after the deadline.

use aeroguard/proof.{Full, Half, NoPayout, NotFinal}
use aiken/collection/list
use aiken/crypto.{VerificationKeyHash}
use aiken/interval.{Finite}
use cardano/address.{VerificationKey}
use cardano/assets.{lovelace_of}
use cardano/transaction.{InlineDatum, OutputReference, Transaction}

pub type Policy {
  holder: VerificationKeyHash,
  insurer: VerificationKeyHash,
  /// 33-byte compressed secp256k1 key of the AeroDataBox Airnode.
  airnode: ByteArray,
  /// Request hashes of flightStatusOnDate for this flight and date, arrival and status projections.
  arrival_request: ByteArray,
  status_request: ByteArray,
  /// Scheduled arrival, exactly as the Airnode signs it: "YYYY-MM-DD HH:MMZ".
  scheduled: ByteArray,
  /// Lovelace paid to the holder on a full payout.
  cover: Int,
  /// POSIX ms after which the insurer may take the cover back if nobody settled.
  deadline: Int,
}

pub type Action {
  Settle {
    timestamp: Int,
    status: ByteArray,
    actual: Option<ByteArray>,
    signature: ByteArray,
  }
  Reclaim
}

/// Lovelace paid to `to` in outputs tagged with this policy's own input. The tag stops double satisfaction: one output
/// cannot settle two policies of the same holder in a single transaction.
fn paid(self: Transaction, to: VerificationKeyHash, own: OutputReference) -> Int {
  let tag: Data = own
  list.foldl(
    self.outputs,
    0,
    fn(output, total) {
      if output.address.payment_credential == VerificationKey(to) && output.datum == InlineDatum(
        tag,
      ) {
        total + lovelace_of(output.value)
      } else {
        total
      }
    },
  )
}

pub fn settles(
  p: Policy,
  action: Action,
  own: OutputReference,
  self: Transaction,
) -> Bool {
  when action is {
    Settle { timestamp, status, actual, signature } -> {
      let request = when actual is {
        Some(_) -> p.arrival_request
        None -> p.status_request
      }
      let data = proof.projected_data(p.scheduled, status, actual)
      expect proof.verify(p.airnode, request, timestamp, data, signature)
      when proof.payout(status, p.scheduled, actual) is {
        Full -> paid(self, p.holder, own) >= p.cover
        Half ->
          paid(self, p.holder, own) >= p.cover / 2 && paid(self, p.insurer, own) >= p.cover - p.cover / 2
        NoPayout -> paid(self, p.insurer, own) >= p.cover
        NotFinal -> False
      }
    }
    Reclaim -> {
      expect Finite(from) = self.validity_range.lower_bound.bound_type
      from > p.deadline && list.has(self.extra_signatories, p.insurer)
    }
  }
}
