//// Spending rule of a flight cover UTxO on Cardano: it holds the cover amount and is spent only by a valid Airnode proof that the
//// flight is final (paying the holder by FlightDelayCover's rule), or by the insurer after the deadline.

use aeroguard/proof.{Full, Half, NoPayout, NotFinal}
use aiken/collection/list
use aiken/crypto.{VerificationKeyHash}
use aiken/interval.{Finite}
use cardano/address.{VerificationKey}
use cardano/assets.{lovelace_of}
use cardano/transaction.{OutputReference, Transaction}

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

fn paid(self: Transaction, to: VerificationKeyHash) -> Int {
  list.foldl(
    self.outputs,
    0,
    fn(output, total) {
      if output.address.payment_credential == VerificationKey(to) {
        total + lovelace_of(output.value)
      } else {
        total
      }
    },
  )
}

pub fn settles(p: Policy, action: Action, self: Transaction) -> Bool {
  when action is {
    Settle { timestamp, status, actual, signature } -> {
      let request =
        when actual is {
          Some(_) -> p.arrival_request
          None -> p.status_request
        }
      let data = proof.projected_data(p.scheduled, status, actual)
      expect proof.verify(p.airnode, request, timestamp, data, signature)
      when proof.payout(status, p.scheduled, actual) is {
        Full -> paid(self, p.holder) >= p.cover
        Half ->
          paid(self, p.holder) >= p.cover / 2 && paid(self, p.insurer) >= p.cover - p.cover / 2
        NoPayout -> paid(self, p.insurer) >= p.cover
        NotFinal -> False
      }
    }
    Reclaim -> {
      expect Finite(from) = self.validity_range.lower_bound.bound_type
      from > p.deadline && list.has(self.extra_signatories, p.insurer)
    }
  }
}
