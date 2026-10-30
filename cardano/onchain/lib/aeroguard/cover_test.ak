use aeroguard/cover.{Policy, Reclaim, Settle, settles}
use aeroguard/proof.{Full, Half, NoPayout, NotFinal}
use aeroguard/vectors as v
use aiken/interval.{Finite, Interval, IntervalBound}
use cardano/address.{from_verification_key}
use cardano/assets.{from_lovelace}
use cardano/transaction.{
  InlineDatum, NoDatum, Output, OutputReference, Transaction, placeholder,
}

const holder: ByteArray =
  #"00000000000000000000000000000000000000000000000000000001"

const insurer: ByteArray =
  #"00000000000000000000000000000000000000000000000000000002"

const cover: Int = 10_000_000

const own: OutputReference =
  OutputReference {
    transaction_id: #"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    output_index: 0,
  }

const other: OutputReference =
  OutputReference {
    transaction_id: #"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    output_index: 1,
  }

// ---- the real Airnode signature

test real_airnode_data_is_rebuilt_byte_for_byte() {
  proof.projected_data(v.scheduled, "Expected", None) == "{\"scheduled\":\"2026-10-30 21:25Z\",\"status\":\"Expected\"}"
}

test real_airnode_signature_verifies() {
  proof.verify(
    v.real_airnode_status_pubkey,
    v.real_airnode_status_request,
    v.real_airnode_status_timestamp,
    proof.projected_data(v.scheduled, v.real_airnode_status_status, None),
    v.real_airnode_status_signature,
  )
}

test tamper_edited_status_fails() {
  !proof.verify(
    v.real_airnode_status_pubkey,
    v.real_airnode_status_request,
    v.real_airnode_status_timestamp,
    proof.projected_data(v.scheduled, "Canceled", None),
    v.real_airnode_status_signature,
  )
}

test tamper_other_request_fails() {
  !proof.verify(
    v.real_airnode_status_pubkey,
    v.test_arrived_200_request,
    v.real_airnode_status_timestamp,
    proof.projected_data(v.scheduled, v.real_airnode_status_status, None),
    v.real_airnode_status_signature,
  )
}

test tamper_other_timestamp_fails() {
  !proof.verify(
    v.real_airnode_status_pubkey,
    v.real_airnode_status_request,
    v.real_airnode_status_timestamp + 1,
    proof.projected_data(v.scheduled, v.real_airnode_status_status, None),
    v.real_airnode_status_signature,
  )
}

test tamper_other_signer_fails() {
  !proof.verify(
    v.test_canceled_pubkey,
    v.real_airnode_status_request,
    v.real_airnode_status_timestamp,
    proof.projected_data(v.scheduled, v.real_airnode_status_status, None),
    v.real_airnode_status_signature,
  )
}

// ---- time and payout rule

test minutes_of_matches_unix_time() {
  and {
    proof.minutes_of("1970-01-01 00:00Z") == 0,
    proof.minutes_of("2026-10-30 21:25Z") == 29889925,
    proof.minutes_of("2024-02-29 23:59Z") == 28487519,
  }
}

test minutes_of_rejects_garbage() fail {
  proof.minutes_of("2026-10-30T21:25Z") > 0
}

test payout_rule() {
  and {
    proof.payout("Expected", v.scheduled, None) == NotFinal,
    proof.payout("Arrived", v.scheduled, None) == NotFinal,
    proof.payout("Canceled", v.scheduled, None) == Full,
    proof.payout("Arrived", v.scheduled, Some("2026-10-31 00:25Z")) == Full,
    proof.payout("Arrived", v.scheduled, Some("2026-10-30 23:25Z")) == Half,
    proof.payout("Arrived", v.scheduled, Some("2026-10-30 23:24Z")) == NoPayout,
  }
}

// ---- the validator, with final outcomes signed by the test key

fn policy(airnode: ByteArray) -> Policy {
  Policy {
    holder,
    insurer,
    airnode,
    arrival_request: v.test_arrived_200_request,
    status_request: v.test_canceled_request,
    scheduled: v.scheduled,
    cover,
    deadline: 1_800_000_000_000,
    max_age: 3_600_000,
  }
}

// A payout tagged with the policy input it settles.
fn pay(to: ByteArray, amount: Int) -> Output {
  pay_tagged(to, amount, own)
}

fn pay_tagged(to: ByteArray, amount: Int, tag: Data) -> Output {
  Output {
    address: from_verification_key(to),
    value: from_lovelace(amount),
    datum: InlineDatum(tag),
    reference_script: None,
  }
}

fn tx(outputs: List<Output>) -> Transaction {
  Transaction { ..placeholder, outputs }
}

/// A transaction valid for ten minutes from `ms`.
fn window(from: Int, to: Int) -> Interval<Int> {
  Interval {
    lower_bound: IntervalBound { bound_type: Finite(from), is_inclusive: True },
    upper_bound: IntervalBound { bound_type: Finite(to), is_inclusive: True },
  }
}

/// Settled within ten minutes of the answer being signed.
fn tx_at(signed: Int, outputs: List<Output>) -> Transaction {
  Transaction {
    ..placeholder,
    outputs,
    validity_range: window(signed * 1000, signed * 1000 + 600_000),
  }
}

test delayed_200_min_pays_holder_in_full() {
  settles(
    policy(v.test_arrived_200_pubkey),
    Settle(
      v.test_arrived_200_timestamp,
      v.test_arrived_200_status,
      Some(v.test_arrived_200_actual),
      v.test_arrived_200_signature,
    ),
    own,
    tx_at(v.test_arrived_200_timestamp, [pay(holder, cover)]),
  )
}

test full_payout_short_paid_fails() fail {
  settles(
    policy(v.test_arrived_200_pubkey),
    Settle(
      v.test_arrived_200_timestamp,
      v.test_arrived_200_status,
      Some(v.test_arrived_200_actual),
      v.test_arrived_200_signature,
    ),
    own,
    tx_at(
      v.test_arrived_200_timestamp,
      [pay(holder, cover - 1), pay(insurer, 1)],
    ),
  )
}

test delayed_130_min_splits_cover() {
  settles(
    policy(v.test_arrived_130_pubkey),
    Settle(
      v.test_arrived_130_timestamp,
      v.test_arrived_130_status,
      Some(v.test_arrived_130_actual),
      v.test_arrived_130_signature,
    ),
    own,
    tx_at(
      v.test_arrived_130_timestamp,
      [pay(holder, cover / 2), pay(insurer, cover / 2)],
    ),
  )
}

test delayed_30_min_returns_cover_to_insurer() {
  settles(
    policy(v.test_arrived_30_pubkey),
    Settle(
      v.test_arrived_30_timestamp,
      v.test_arrived_30_status,
      Some(v.test_arrived_30_actual),
      v.test_arrived_30_signature,
    ),
    own,
    tx_at(v.test_arrived_30_timestamp, [pay(insurer, cover)]),
  )
}

test delayed_30_min_cannot_pay_holder() fail {
  settles(
    policy(v.test_arrived_30_pubkey),
    Settle(
      v.test_arrived_30_timestamp,
      v.test_arrived_30_status,
      Some(v.test_arrived_30_actual),
      v.test_arrived_30_signature,
    ),
    own,
    tx_at(v.test_arrived_30_timestamp, [pay(holder, cover)]),
  )
}

test canceled_pays_holder_in_full() {
  settles(
    policy(v.test_canceled_pubkey),
    Settle(
      v.test_canceled_timestamp,
      v.test_canceled_status,
      None,
      v.test_canceled_signature,
    ),
    own,
    tx_at(v.test_canceled_timestamp, [pay(holder, cover)]),
  )
}

test claimed_delay_with_edited_actual_fails() fail {
  settles(
    policy(v.test_arrived_30_pubkey),
    Settle(
      v.test_arrived_30_timestamp,
      v.test_arrived_30_status,
      Some(v.test_arrived_200_actual),
      v.test_arrived_30_signature,
    ),
    own,
    tx_at(v.test_arrived_30_timestamp, [pay(holder, cover)]),
  )
}

test proof_from_another_key_fails() fail {
  settles(
    policy(v.real_airnode_status_pubkey),
    Settle(
      v.test_arrived_200_timestamp,
      v.test_arrived_200_status,
      Some(v.test_arrived_200_actual),
      v.test_arrived_200_signature,
    ),
    own,
    tx_at(v.test_arrived_200_timestamp, [pay(holder, cover)]),
  )
}

test real_pre_departure_proof_cannot_settle() fail {
  settles(
    Policy {
      ..policy(v.real_airnode_status_pubkey),
      status_request: v.real_airnode_status_request,
    },
    Settle(
      v.real_airnode_status_timestamp,
      v.real_airnode_status_status,
      None,
      v.real_airnode_status_signature,
    ),
    own,
    tx_at(v.real_airnode_status_timestamp, [pay(holder, cover)]),
  )
}

fn after(ms: Int, signers: List<ByteArray>) -> Transaction {
  Transaction {
    ..placeholder,
    validity_range: Interval {
      lower_bound: IntervalBound { bound_type: Finite(ms), is_inclusive: True },
      upper_bound: placeholder.validity_range.upper_bound,
    },
    extra_signatories: signers,
  }
}

test insurer_reclaims_after_deadline() {
  settles(
    policy(v.test_canceled_pubkey),
    Reclaim,
    own,
    after(1_800_000_000_001, [insurer]),
  )
}

test insurer_cannot_reclaim_before_deadline() {
  !settles(
    policy(v.test_canceled_pubkey),
    Reclaim,
    own,
    after(1_799_999_999_999, [insurer]),
  )
}

test stranger_cannot_reclaim() {
  !settles(
    policy(v.test_canceled_pubkey),
    Reclaim,
    own,
    after(1_800_000_000_001, [holder]),
  )
}

test untagged_payout_does_not_count() fail {
  settles(
    policy(v.test_arrived_200_pubkey),
    Settle(
      v.test_arrived_200_timestamp,
      v.test_arrived_200_status,
      Some(v.test_arrived_200_actual),
      v.test_arrived_200_signature,
    ),
    own,
    tx_at(
      v.test_arrived_200_timestamp,
      [
        Output {
          address: from_verification_key(holder),
          value: from_lovelace(cover),
          datum: NoDatum,
          reference_script: None,
        },
      ],
    ),
  )
}

// Two policies of the same holder spent together: one payout tagged for the first cannot also settle the second.
test one_payout_cannot_settle_two_policies() {
  let both = tx_at(
    v.test_arrived_200_timestamp,
    [pay_tagged(holder, cover, own)],
  )
  let settle = Settle(
    v.test_arrived_200_timestamp,
    v.test_arrived_200_status,
    Some(v.test_arrived_200_actual),
    v.test_arrived_200_signature,
  )
  and {
    settles(policy(v.test_arrived_200_pubkey), settle, own, both),
    !settles(policy(v.test_arrived_200_pubkey), settle, other, both),
  }
}

// ---- a live arrival-projection answer (IB1314 en route), signed by the real Airnode

test real_airnode_arrival_signature_verifies() {
  proof.verify(
    v.real_airnode_arrival_pubkey,
    v.real_airnode_arrival_request,
    v.real_airnode_arrival_timestamp,
    proof.projected_data(
      v.scheduled,
      v.real_airnode_arrival_status,
      Some(v.real_airnode_arrival_actual),
    ),
    v.real_airnode_arrival_signature,
  )
}

test real_airnode_arrival_relabelled_as_arrived_fails() {
  !proof.verify(
    v.real_airnode_arrival_pubkey,
    v.real_airnode_arrival_request,
    v.real_airnode_arrival_timestamp,
    proof.projected_data(
      v.scheduled,
      "Arrived",
      Some(v.real_airnode_arrival_actual),
    ),
    v.real_airnode_arrival_signature,
  )
}

test real_airnode_en_route_cannot_settle() fail {
  settles(
    Policy {
      ..policy(v.real_airnode_arrival_pubkey),
      arrival_request: v.real_airnode_arrival_request,
    },
    Settle(
      v.real_airnode_arrival_timestamp,
      v.real_airnode_arrival_status,
      Some(v.real_airnode_arrival_actual),
      v.real_airnode_arrival_signature,
    ),
    own,
    tx_at(v.real_airnode_arrival_timestamp, [pay(holder, cover)]),
  )
}

// ---- freshness, as FlightDelayCover checks it

fn settle_200() {
  Settle(
    v.test_arrived_200_timestamp,
    v.test_arrived_200_status,
    Some(v.test_arrived_200_actual),
    v.test_arrived_200_signature,
  )
}

fn paid_at(from: Int, to: Int) -> Transaction {
  Transaction {
    ..placeholder,
    outputs: [pay(holder, cover)],
    validity_range: window(from, to),
  }
}

test fresh_answer_settles() {
  let signed = v.test_arrived_200_timestamp * 1000
  settles(
    policy(v.test_arrived_200_pubkey),
    settle_200(),
    own,
    paid_at(signed, signed + 3_600_000),
  )
}

test stale_answer_fails() fail {
  let signed = v.test_arrived_200_timestamp * 1000
  settles(
    policy(v.test_arrived_200_pubkey),
    settle_200(),
    own,
    paid_at(signed, signed + 3_600_001),
  )
}

test answer_from_the_future_fails() fail {
  let signed = v.test_arrived_200_timestamp * 1000
  settles(
    policy(v.test_arrived_200_pubkey),
    settle_200(),
    own,
    paid_at(signed - 1, signed + 600_000),
  )
}

test unbounded_validity_fails() fail {
  settles(
    policy(v.test_arrived_200_pubkey),
    settle_200(),
    own,
    tx([pay(holder, cover)]),
  )
}

test answer_signed_before_the_landing_it_reports_fails() fail {
  settles(
    policy(v.test_arrived_early_pubkey),
    Settle(
      v.test_arrived_early_timestamp,
      v.test_arrived_early_status,
      Some(v.test_arrived_early_actual),
      v.test_arrived_early_signature,
    ),
    own,
    tx_at(v.test_arrived_early_timestamp, [pay(holder, cover)]),
  )
}

test early_answer_signature_itself_is_valid() {
  proof.verify(
    v.test_arrived_early_pubkey,
    v.test_arrived_early_request,
    v.test_arrived_early_timestamp,
    proof.projected_data(
      v.scheduled,
      v.test_arrived_early_status,
      Some(v.test_arrived_early_actual),
    ),
    v.test_arrived_early_signature,
  )
}
