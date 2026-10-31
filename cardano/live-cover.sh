#!/bin/sh
# The Aiken flight cover live on Cardano preprod, settled by a verdict an agent bought over x402.
#
#   sh live-cover.sh now [FLIGHT DATE]            # a flight that already landed (default LH1816 2026-10-30):
#                                                 #   pay 2 tADA for its final verdict, open a 5 tADA cover, settle it with that verdict
#   sh live-cover.sh open FLIGHT DATE POLICY_ID   # a flight that lands today: open a cover now; the scheduled arrival is
#                                                 #   read from FlightDelayCover policy #POLICY_ID on Base Sepolia
#   sh live-cover.sh settle FLIGHT DATE OPEN_TX   # once it landed and the keeper published its answer: import it, pay, settle
#
# Needs cardano/.env (BUYER_MNEMONIC, SELLER_MNEMONIC, BLOCKFROST_PROJECT_ID). The buyer wallet pays the verdict and also
# funds the cover (it holds the faucet tADA); the cover's holder is the seller address. Every tx is written to
# COVER-EVIDENCE.md. The answer may be up to 24 h old when it settles (max age 1440 min).
set -e
cd "$(dirname "$0")"
envv() { node --env-file-if-exists=.env -p "process.env.$1 || ''"; }
BF_KEY=$(envv BLOCKFROST_PROJECT_ID)
BF=${BLOCKFROST_BASE_URL:-https://cardano-preprod.blockfrost.io/api/v0}
HOLDER=$(node --env-file-if-exists=.env --input-type=module -e "import { sellerAddress } from './src/cardano.ts'; console.log(sellerAddress())")
LOG=COVER-EVIDENCE.md
[ -f $LOG ] || printf '# Aiken flight cover on Cardano preprod\n\nScript `%s`, address `%s`. Each cover is opened by the insurer and settled\nwith a real AeroDataBox Airnode signature that an agent bought over x402. Written by `sh live-cover.sh`.\n\n| Time | Flight | Step | Tx (Cardanoscan preprod) |\n|---|---|---|---|\n' \
  107d68180f4399c12060b76c4869e9790aeffc9957c7ef44fb2447c7 addr_test1wqg866qcpapensfqvzmkcjrfa9us4mlun9tu0m6ylvjy03cx080wx > $LOG
row() { echo "| $(date -u '+%Y-%m-%d %H:%M') UTC | $1 $2 | $3 | [${4%"${4#????????????????}"}…](https://preprod.cardanoscan.io/transaction/$4) |" >> $LOG; }

wait_tx() {
  printf 'waiting for %s on chain' "$1"; i=0
  until curl -sf -H "project_id: $BF_KEY" "$BF/txs/$1" >/dev/null; do
    i=$((i+1)); [ $i -gt 50 ] && { echo; echo "not on chain after 5 min: $1"; exit 1; }
    printf '.'; sleep 6
  done
  echo ' ok'; sleep 15 # let Blockfrost index the outputs before they are spent
}

# Pay over x402 for the verdict (a real paid request, recorded in EVIDENCE.md) and keep its body for the settle redeemer.
buy() {
  RUN_JSON="evidence/run-$1-$2.json" npm run -s qualify -- --flight "$1" --date "$2"
  node -e "const fs = require('fs'); const r = JSON.parse(fs.readFileSync('evidence/run-$1-$2.json', 'utf8')); fs.writeFileSync('evidence/verdict-$1-$2.json', JSON.stringify(r.response, null, 2) + '\n')"
}

open() { # flight date [scheduled]
  SELLER_MNEMONIC=$(envv BUYER_MNEMONIC) npm run -s cover -- open --flight "$1" --date "$2" --holder "$HOLDER" --ada 5 --hours 48 \
    --max-age-min 1440 ${3:+--scheduled "$3"}
  OPEN_TX=$(tail -n 1 "${COVERS_LOG:-evidence/covers.jsonl}" | node -p "JSON.parse(require('fs').readFileSync(0, 'utf8')).openTx")
  row "$1" "$2" "open: 5 tADA locked at the script" "$OPEN_TX"
  echo "OPEN_TX=$OPEN_TX"
}

settle() { # flight date open_tx
  npm run -s cover -- settle --open "$3" --verdict "evidence/verdict-$1-$2.json" | tee /tmp/aeroguard-settle.txt
  out=$(cat /tmp/aeroguard-settle.txt)
  [ -n "$(echo "$out" | grep cardanoscan)" ] || { echo "settle failed, see above"; exit 1; }
  tx=$(echo "$out" | sed -n 's|.*cardanoscan.io/transaction/||p' | tail -n 1)
  case "$out" in
    *'settled (none)'*) what='no delay payout: the cover goes back to the insurer' ;;
    *'settled (half)'*) what='half the cover paid to the holder' ;;
    *) what='the full cover paid to the holder' ;;
  esac
  row "$1" "$2" "settle: $what (the Airnode signature is checked by the script)" "$tx"
  echo "recorded in cardano/$LOG — commit it with EVIDENCE.md and evidence/"
}

case "$1" in
  now)
    F=${2:-LH1816}; D=${3:-2026-10-30}
    buy "$F" "$D"
    open "$F" "$D"
    wait_tx "$OPEN_TX"
    settle "$F" "$D" "$OPEN_TX" ;;
  open)
    [ -n "$4" ] || { echo "usage: sh live-cover.sh open FLIGHT DATE POLICY_ID"; exit 1; }
    SCHED=$(node --input-type=module -e "
      import { createPublicClient, http, parseAbi } from 'viem'; import { baseSepolia } from 'viem/chains';
      const p = await createPublicClient({ chain: baseSepolia, transport: http(process.env.BASE_SEPOLIA_RPC) }).readContract({ address: '0x257054204c4Cd43846C4553eBe6D709841980a80',
        abi: parseAbi(['function policy(uint256) view returns ((address holder, uint64 scheduledArrival, uint32 maxAge, uint8 status, uint128 premium, uint128 coverage, bytes32 arrivalRequestHash, bytes32 statusRequestHash, bytes32 cardanoJobRef, string flight, string date))']),
        functionName: 'policy', args: [$4n] });
      if (p.flight !== '$2' || p.date !== '$3') throw new Error('policy #$4 is ' + p.flight + ' ' + p.date);
      console.log(new Date(Number(p.scheduledArrival) * 1000).toISOString().slice(0, 16).replace('T', ' ') + 'Z');")
    echo "policy #$4: $2 $3, scheduled arrival $SCHED"
    open "$2" "$3" "$SCHED"
    echo "after it lands: sh live-cover.sh settle $2 $3 $OPEN_TX" ;;
  settle)
    [ -n "$4" ] || { echo "usage: sh live-cover.sh settle FLIGHT DATE OPEN_TX"; exit 1; }
    git fetch -q origin keeper-data && git show origin/keeper-data:keeper.json > /tmp/keeper.json
    npm run -s import-evidence -- /tmp/keeper.json
    buy "$2" "$3"
    settle "$2" "$3" "$4" ;;
  *) sed -n '2,9p' "$0"; exit 1 ;;
esac
