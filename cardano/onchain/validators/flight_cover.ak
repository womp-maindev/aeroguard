//// A flight cover UTxO on Cardano: it holds the cover amount and is spent only by a valid Airnode proof that the
//// flight is final (paying the holder by FlightDelayCover's rule), or by the insurer after the deadline.

use aeroguard/cover.{Action, Policy, settles}
use cardano/transaction.{OutputReference, Transaction}

validator flight_cover {
  spend(
    datum: Option<Policy>,
    action: Action,
    own: OutputReference,
    self: Transaction,
  ) {
    expect Some(p) = datum
    settles(p, action, own, self)
  }

  else(_) {
    fail
  }
}
