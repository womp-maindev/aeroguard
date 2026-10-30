//// Checks an AeroDataBox Airnode response with Plutus V3 builtins only, as FlightDelayCover does on EVM:
//// keccak256(prefix ‖ keccak256(requestHash ‖ uint256(timestamp) ‖ data)) signed by the Airnode's secp256k1 key.
//// Plutus cannot recover a key from a signature, so the policy stores the Airnode's 33-byte compressed key.
//// The data is never parsed: the validator rebuilds the exact signed bytes from typed fields.

use aiken/collection/list
use aiken/crypto.{keccak_256, verify_ecdsa_signature}
use aiken/primitive/bytearray

/// "\x19Ethereum Signed Message:\n32"
pub const eth_prefix: ByteArray =
  #"19457468657265756d205369676e6564204d6573736167653a0a3332"

/// FlightDelayCover.HALF_PAYOUT_DELAY / FULL_PAYOUT_DELAY, in minutes.
pub const half_payout_delay: Int = 120

pub const full_payout_delay: Int = 180

pub type Payout {
  Full
  Half
  NoPayout
  NotFinal
}

fn cat(parts: List<ByteArray>) -> ByteArray {
  list.foldr(parts, #"", bytearray.concat)
}

/// The JSON the Airnode signs for the arrival or the status projection, keys in code point order.
pub fn projected_data(
  scheduled: ByteArray,
  status: ByteArray,
  actual: Option<ByteArray>,
) -> ByteArray {
  // {"scheduled":"…","status":"…"}
  let tail = cat(
    [
      #"227363686564756c6564223a22", scheduled, #"222c22737461747573223a22",
      status, #"227d",
    ],
  )
  when actual is {
    // {"actual":"…",
    Some(a) -> cat([#"7b2261637475616c223a22", a, #"222c", tail])
    None -> bytearray.push(tail, 0x7b)
  }
}

/// The 32-byte message the Airnode's key signed.
pub fn message_hash(
  request_hash: ByteArray,
  timestamp: Int,
  data: ByteArray,
) -> ByteArray {
  let inner = keccak_256(
    cat([request_hash, bytearray.from_int_big_endian(timestamp, 32), data]),
  )
  keccak_256(bytearray.concat(eth_prefix, inner))
}

/// `signature` is r ‖ s (64 bytes, low-s); an EVM signature's trailing v byte is dropped off chain.
pub fn verify(
  airnode: ByteArray,
  request_hash: ByteArray,
  timestamp: Int,
  data: ByteArray,
  signature: ByteArray,
) -> Bool {
  verify_ecdsa_signature(
    airnode,
    message_hash(request_hash, timestamp, data),
    signature,
  )
}

fn digits(b: ByteArray, from: Int, count: Int) -> Int {
  bytearray.foldl(
    bytearray.slice(b, from, from + count - 1),
    0,
    fn(byte, acc) {
      expect byte >= 0x30 && byte <= 0x39
      acc * 10 + byte - 0x30
    },
  )
}

/// Minutes since 1970-01-01 for "YYYY-MM-DD HH:MMZ" (Howard Hinnant's days_from_civil).
pub fn minutes_of(t: ByteArray) -> Int {
  expect bytearray.length(t) == 17
  expect bytearray.at(t, 4) == 0x2d && bytearray.at(t, 7) == 0x2d
  expect bytearray.at(t, 10) == 0x20 && bytearray.at(t, 13) == 0x3a
  expect bytearray.at(t, 16) == 0x5a
  let y0 = digits(t, 0, 4)
  let mo = digits(t, 5, 2)
  let d = digits(t, 8, 2)
  let h = digits(t, 11, 2)
  let mi = digits(t, 14, 2)
  expect mo >= 1 && mo <= 12 && d >= 1 && d <= 31 && h <= 23 && mi <= 59
  let y = if mo <= 2 {
    y0 - 1
  } else {
    y0
  }
  let era = y / 400
  let yoe = y - era * 400
  let mp = if mo > 2 {
    mo - 3
  } else {
    mo + 9
  }
  let doy = ( 153 * mp + 2 ) / 5 + d - 1
  let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy
  let days = era * 146097 + doe - 719468
  days * 1440 + h * 60 + mi
}

/// Same rule as FlightDelayCover: cancelled or ≥ 180 min pays in full, ≥ 120 min pays half.
pub fn payout(
  status: ByteArray,
  scheduled: ByteArray,
  actual: Option<ByteArray>,
) -> Payout {
  if status == "Canceled" {
    Full
  } else if status != "Arrived" {
    NotFinal
  } else {
    when actual is {
      None -> NotFinal
      Some(a) -> {
        let delay = minutes_of(a) - minutes_of(scheduled)
        if delay >= full_payout_delay {
          Full
        } else if delay >= half_payout_delay {
          Half
        } else {
          NoPayout
        }
      }
    }
  }
}
