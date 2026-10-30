// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {AirnodeV2Attestation} from "./AirnodeV2Attestation.sol";
import {ProjectedJson} from "./ProjectedJson.sol";
import {SafeCast} from "@openzeppelin/contracts/utils/math/SafeCast.sol";

/// @title AeroGuard FlightDelayCover
/// @notice Parametric flight-delay cover that pays out only on AeroDataBox data signed by its AirnodeHub Airnode.
/// Nobody files a claim and nobody approves one: anyone (normally the AeroGuard keeper agent) submits a signed
/// AeroDataBox response, and this contract decides.
/// @dev Trust model. The signature proves the AeroDataBox Airnode produced exactly this data for exactly this request
/// at this time. It does not prove that AeroDataBox itself is right about the real world. Every request hash is
/// DERIVED ON-CHAIN from the policy's flight number and date, so nobody (not even the agent that sold the policy) can
/// settle a policy with a response about another flight, another date or another projection.
contract FlightDelayCover is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ---------------------------------------------------------------- constants

    /// @notice Signed fields we need. Kept tiny: a projected response costs a fraction of the gas of the full body.
    /// ARRIVAL projection: proves when the flight actually arrived. STATUS projection: proves a cancellation
    /// (a cancelled flight has no revised arrival time, and a missing pointer makes the Airnode answer 400).
    string internal constant OP = "flightStatusOnDate";
    string internal constant ARRIVAL_PROJECTION =
        '[["actual","/0/arrival/revisedTime/utc"],["scheduled","/0/arrival/scheduledTime/utc"],["status","/0/status"]]';
    string internal constant STATUS_PROJECTION =
        '[["scheduled","/0/arrival/scheduledTime/utc"],["status","/0/status"]]';

    uint32 public constant HALF_PAYOUT_DELAY = 120 minutes;
    uint32 public constant FULL_PAYOUT_DELAY = 180 minutes;
    uint256 public constant SETTLEMENT_WINDOW = 3 days; // after scheduled arrival; then policy can be expired
    uint256 public constant MAX_FUTURE_SKEW = 60; // seconds a signature may be ahead of block time
    /// @notice Max age of the signed status response a public buyer attaches as purchase proof.
    uint256 public constant PURCHASE_MAX_AGE = 15 minutes;
    /// @notice Private policies: the signed scheduled arrival at settlement must be within this distance of the
    /// buyer-supplied one (the agent rounds it to the hour). Public policies store the signed value: tolerance 0.
    uint256 public constant SCHEDULE_TOLERANCE = 1 hours;
    /// @notice A private policy cannot anchor its expiry further than this from now (bounds capital lock-up).
    uint256 public constant MAX_HORIZON = 400 days;

    // ---------------------------------------------------------------- types

    enum Status {
        None,
        Active,
        PaidHalf,
        PaidFull,
        ClosedNoPayout,
        Expired
    }

    struct Policy {
        address holder;
        uint64 scheduledArrival; // unix seconds, informational + expiry anchor (signed value is authoritative)
        uint32 maxAge; // max age (s) of a signed response at settlement
        Status status;
        uint128 premium;
        uint128 coverage;
        bytes32 arrivalRequestHash;
        bytes32 statusRequestHash;
        bytes32 cardanoJobRef; // keccak256 of the Masumi/Sokosumi job id that paid for this policy on Cardano
        string flight; // e.g. "LH1234"
        string date; // local departure date, "YYYY-MM-DD"
    }

    // ---------------------------------------------------------------- storage

    IERC20 public immutable token; // aUSD on Base Sepolia
    address public immutable airnode; // AeroDataBox Airnode signer

    uint16 public premiumBps; // premium as share of coverage
    uint32 public defaultMaxAge;
    uint128 public maxCoverage;
    /// @notice Cover must be bought at least this long before the scheduled arrival. Default 2h; 0 is for demos only
    /// (it lets anyone buy cover for a flight minutes before landing).
    uint32 public minLeadTime = 2 hours;
    uint256 public reserved; // sum of coverage of Active policies
    uint256 public nextId = 1;

    mapping(uint256 => Policy) internal _policies;
    /// @notice Private policies: keccak256(abi.encode(flight, date, salt)); zero for public policies.
    mapping(uint256 => bytes32) public commitmentOf;

    // ---------------------------------------------------------------- events / errors

    event PolicyBought(
        uint256 indexed id,
        address indexed holder,
        string flight,
        string date,
        uint256 premium,
        uint256 coverage,
        bytes32 arrivalRequestHash,
        bytes32 statusRequestHash,
        bytes32 cardanoJobRef
    );
    event Settled(
        uint256 indexed id, Status status, uint256 delayMinutes, bool cancelled, uint256 payout, bytes32 responseId
    );
    /// @notice A private policy: no flight, no date, no request hashes until it settles.
    event PrivatePolicyBought(
        uint256 indexed id,
        address indexed holder,
        bytes32 commitment,
        uint256 premium,
        uint256 coverage,
        bytes32 cardanoJobRef
    );
    /// @notice Emitted by settlePrivate once the commitment opened (the flight is public in that calldata anyway).
    event PrivatePolicyRevealed(uint256 indexed id, string flight, string date);
    event Expired(uint256 indexed id);
    event PoolFunded(address indexed from, uint256 amount);
    event ParamsUpdated(uint16 premiumBps, uint32 defaultMaxAge, uint128 maxCoverage);
    event MinLeadTimeUpdated(uint32 minLeadTime);

    error WrongRequest(bytes32 got);
    error Stale(uint256 timestamp);
    error FromTheFuture(uint256 timestamp);
    error ObservedTooEarly(uint256 signedAt, uint256 observedAt);
    error NotFinal(string status);
    error NotActive(uint256 id);
    error Insolvent(uint256 needed, uint256 free);
    error BadFlight();
    error BadDate();
    error BadCoverage();
    error WindowOpen(uint256 until);
    error ScheduleMismatch(uint256 signedScheduled, uint256 storedScheduled);
    error BadSchedule();
    error BadCommitment();
    error PrivatePolicy(uint256 id);
    error NotPrivate(uint256 id);
    error NotBuyable(string status);
    error TooCloseToArrival(uint256 scheduled, uint256 earliestAllowed);

    constructor(IERC20 token_, address airnode_, uint16 premiumBps_, uint32 defaultMaxAge_, uint128 maxCoverage_)
        Ownable(msg.sender)
    {
        token = token_;
        airnode = airnode_;
        _setParams(premiumBps_, defaultMaxAge_, maxCoverage_);
    }

    // ---------------------------------------------------------------- views

    function policy(uint256 id) external view returns (Policy memory) {
        return _policies[id];
    }

    function freeCapital() public view returns (uint256) {
        uint256 bal = token.balanceOf(address(this));
        return bal > reserved ? bal - reserved : 0;
    }

    function quote(uint128 coverage) public view returns (uint128) {
        return uint128((uint256(coverage) * premiumBps) / 10_000);
    }

    /// @notice The exact request hash an Airnode will sign for this flight/date and projection.
    /// Mirrors AirnodeHub: keccak256(utf8(JSON.stringify([operation, sortedParamEntries, sortedProjectionEntries])))
    function requestHashFor(string memory flight, string memory date, bool arrival) public pure returns (bytes32) {
        return keccak256(
            abi.encodePacked(
                '["',
                OP,
                '",[["dateLocal","',
                date,
                '"],["searchBy","number"],["searchParam","',
                flight,
                '"]],',
                arrival ? ARRIVAL_PROJECTION : STATUS_PROJECTION,
                "]"
            )
        );
    }

    /// @notice Commitment a buyer passes to buyPrivatePolicy. `salt` must be 32 random bytes kept off-chain until
    /// settlement; with a guessable salt anyone can brute-force today's flight list against the commitment.
    function commitmentFor(string memory flight, string memory date, bytes32 salt) public pure returns (bytes32) {
        return keccak256(abi.encode(flight, date, salt));
    }

    // ---------------------------------------------------------------- core

    /// @notice Buy cover for `holder`. Caller pays the premium in `token`.
    /// @dev Purchase proof: a fresh AeroDataBox STATUS-projection response ({scheduled,status}) signed by the Airnode
    /// for requestHashFor(flight, date, false). It proves the flight exists, has not left the gate yet (no delay,
    /// cancellation or landing is known) and fixes scheduledArrival to the signed value, not a caller input.
    /// A proof for another flight/date/projection fails as NotSignedByAirnode (the hash is derived, not passed in).
    /// @param flight IATA/ICAO flight number, uppercase letters and digits only, e.g. "LH1234"
    /// @param date local departure date "YYYY-MM-DD" (as AeroDataBox dateLocal)
    /// @param timestamp, data, signature the signed status response, exactly as AirnodeHub returned it
    function buyPolicy(
        string calldata flight,
        string calldata date,
        uint128 coverage,
        address holder,
        bytes32 cardanoJobRef,
        uint256 timestamp,
        bytes calldata data,
        bytes calldata signature
    ) external nonReentrant returns (uint256 id) {
        _checkFlight(flight);
        _checkDate(date);
        uint64 scheduled = _checkPurchaseProof(requestHashFor(flight, date, false), timestamp, data, signature);
        id = _openPublic(flight, date, scheduled, coverage, holder, cardanoJobRef);
    }

    function _openPublic(
        string calldata flight,
        string calldata date,
        uint64 scheduled,
        uint128 coverage,
        address holder,
        bytes32 cardanoJobRef
    ) internal returns (uint256 id) {
        Policy storage p;
        (id, p) = _open(scheduled, coverage, holder, cardanoJobRef);
        p.arrivalRequestHash = requestHashFor(flight, date, true);
        p.statusRequestHash = requestHashFor(flight, date, false);
        p.flight = flight;
        p.date = date;
        _emitBought(id, p);
    }

    function _emitBought(uint256 id, Policy storage p) internal {
        emit PolicyBought(
            id, p.holder, p.flight, p.date, p.premium, p.coverage, p.arrivalRequestHash, p.statusRequestHash, p.cardanoJobRef
        );
    }

    /// @dev Signer + request + freshness + pre-departure status + lead time. Returns the signed scheduled arrival.
    function _checkPurchaseProof(bytes32 statusHash, uint256 timestamp, bytes calldata data, bytes calldata signature)
        internal
        view
        returns (uint64)
    {
        AirnodeV2Attestation.verify(airnode, statusHash, timestamp, data, signature);
        if (timestamp > block.timestamp + MAX_FUTURE_SKEW) revert FromTheFuture(timestamp);
        if (timestamp + PURCHASE_MAX_AGE < block.timestamp) revert Stale(timestamp);
        string memory status = ProjectedJson.readString(data, "status");
        // pre-departure only: Delayed/Departed/EnRoute/Arrived/Canceled/Diverted… all leak (or are) the outcome
        if (!(_eq(status, "Expected") || _eq(status, "Unknown") || _eq(status, "CheckIn") || _eq(status, "Boarding")))
        {
            revert NotBuyable(status);
        }
        uint256 scheduled = ProjectedJson.readTimestamp(data, "scheduled");
        _checkLead(scheduled);
        return SafeCast.toUint64(scheduled);
    }

    function _checkLead(uint256 scheduled) internal view {
        uint256 earliest = block.timestamp + minLeadTime;
        if (scheduled < earliest) revert TooCloseToArrival(scheduled, earliest);
    }

    /// @notice Buy cover without revealing the flight. Only `commitment` = commitmentFor(flight, date, salt) is stored;
    /// flight, date and both request hashes stay empty until settlePrivate opens the commitment. Coverage, holder and
    /// scheduledArrival are public: round scheduledArrival to the hour so it does not narrow down the flight;
    /// settlement tolerates SCHEDULE_TOLERANCE (1h) of difference against the signed value.
    /// @dev Residual risk: no purchase proof is possible without revealing the flight, so a private buyer could insure
    /// an already-delayed flight. Bounded by minLeadTime before (scheduled ± 1h); production fix is a ZK proof of the
    /// purchase-time signed status against the commitment.
    function buyPrivatePolicy(
        bytes32 commitment,
        uint128 coverage,
        address holder,
        bytes32 cardanoJobRef,
        uint64 scheduledArrival
    ) external nonReentrant returns (uint256 id) {
        if (commitment == bytes32(0)) revert BadCommitment();
        if (scheduledArrival > block.timestamp + MAX_HORIZON) revert BadSchedule();
        _checkLead(scheduledArrival);
        Policy storage p;
        (id, p) = _open(scheduledArrival, coverage, holder, cardanoJobRef);
        commitmentOf[id] = commitment;
        emit PrivatePolicyBought(id, holder, commitment, p.premium, coverage, cardanoJobRef);
    }

    /// @notice Settle with a signed AeroDataBox response. Callable by anyone: the data, not the caller, is trusted.
    /// @param requestHash the hash the Airnode signed; must equal one of the two hashes derived for this policy
    /// @param data the exact signed bytes (UTF-8 of the projected JSON)
    function settle(uint256 id, bytes32 requestHash, uint256 timestamp, bytes calldata data, bytes calldata signature)
        external
        nonReentrant
    {
        Policy storage p = _policies[id];
        if (p.status != Status.Active) revert NotActive(id);
        if (p.arrivalRequestHash == bytes32(0)) revert PrivatePolicy(id); // only unrevealed private ones lack it
        _settle(id, p, requestHash, timestamp, data, signature, 0);
    }

    /// @notice Settle a private policy: opens the commitment, derives both request hashes from the revealed flight and
    /// date exactly as buyPolicy does (and stores them on the policy), then runs the very same checks as settle.
    /// If any check fails the whole call reverts, the hashes are not kept and the policy stays private on-chain
    /// (though the reverted calldata is still visible to anyone watching the mempool).
    function settlePrivate(
        uint256 id,
        string calldata flight,
        string calldata date,
        bytes32 salt,
        bytes32 requestHash,
        uint256 timestamp,
        bytes calldata data,
        bytes calldata signature
    ) external nonReentrant {
        Policy storage p = _reveal(id, flight, date, salt);
        _settle(id, p, requestHash, timestamp, data, signature, SCHEDULE_TOLERANCE);
    }

    /// @dev Opens a private policy's commitment and writes the request hashes derived from it.
    function _reveal(uint256 id, string calldata flight, string calldata date, bytes32 salt)
        internal
        returns (Policy storage p)
    {
        p = _policies[id];
        if (p.status != Status.Active) revert NotActive(id);
        bytes32 c = commitmentOf[id];
        if (c == bytes32(0)) revert NotPrivate(id);
        if (commitmentFor(flight, date, salt) != c) revert BadCommitment();
        // same character rules as buyPolicy, so the derived hash is exactly what AirnodeHub hashes
        _checkFlight(flight);
        _checkDate(date);
        p.arrivalRequestHash = requestHashFor(flight, date, true);
        p.statusRequestHash = requestHashFor(flight, date, false);
        emit PrivatePolicyRevealed(id, flight, date);
    }

    /// @dev Shared by settle and settlePrivate. Caller has checked the policy is Active.
    function _settle(
        uint256 id,
        Policy storage p,
        bytes32 requestHash,
        uint256 timestamp,
        bytes calldata data,
        bytes calldata signature,
        uint256 tolerance
    ) internal {
        // 1. intended request (flight, date, operation, projection) — derived on-chain, never taken from the caller
        bool isArrival = requestHash == p.arrivalRequestHash;
        if (!isArrival && requestHash != p.statusRequestHash) revert WrongRequest(requestHash);

        // 2. expected signer (also binds timestamp + data: one edited byte changes the recovered signer)
        AirnodeV2Attestation.verify(airnode, requestHash, timestamp, data, signature);

        // 3. time: fresh enough, not from the future
        if (timestamp > block.timestamp + MAX_FUTURE_SKEW) revert FromTheFuture(timestamp);
        if (timestamp + p.maxAge < block.timestamp) revert Stale(timestamp);

        // 4. no duplicate execution: per policy. Only Active policies reach here, and _close moves the policy out of
        // Active before any transfer, so each policy settles at most once. The same signed response may settle every
        // policy on that flight+date (same request hash => same truth), which is deliberate: one paid lookup, one
        // outcome, all its policies. responseId only labels the evidence in the Settled event.
        // 5. decide from signed fields only
        _finish(id, p, isArrival, timestamp, data, tolerance, keccak256(signature));
    }

    function _finish(
        uint256 id,
        Policy storage p,
        bool isArrival,
        uint256 timestamp,
        bytes calldata data,
        uint256 tolerance,
        bytes32 responseId
    ) internal {
        (uint256 delay, bool cancelled) = _decide(isArrival, timestamp, data, p.scheduledArrival, tolerance);
        _close(id, p, delay, cancelled, responseId);
    }

    /// @dev Reads the signed fields and returns the delay (seconds) or a cancellation. Reverts unless final.
    function _decide(bool isArrival, uint256 timestamp, bytes calldata data, uint256 storedScheduled, uint256 tolerance)
        internal
        pure
        returns (uint256 delay, bool cancelled)
    {
        string memory status = ProjectedJson.readString(data, "status");
        uint256 scheduled = ProjectedJson.readTimestamp(data, "scheduled");
        // the stored scheduledArrival anchors expiry and lead time; it must describe this flight, or no payout.
        // Public: stored = signed at purchase, so exact. Private: buyer-supplied, within SCHEDULE_TOLERANCE.
        uint256 diff = scheduled > storedScheduled ? scheduled - storedScheduled : storedScheduled - scheduled;
        if (diff > tolerance) revert ScheduleMismatch(scheduled, storedScheduled);

        if (isArrival) {
            if (!_eq(status, "Arrived")) revert NotFinal(status);
            uint256 actual = ProjectedJson.readTimestamp(data, "actual");
            // source observation time: the response must have been signed after the landing it reports
            if (timestamp < actual) revert ObservedTooEarly(timestamp, actual);
            delay = actual > scheduled ? (actual - scheduled) : 0;
        } else {
            if (!_eq(status, "Canceled")) revert NotFinal(status);
            // a cancellation must be observed no earlier than 24h before the scheduled arrival
            if (timestamp + 1 days < scheduled) revert ObservedTooEarly(timestamp, scheduled);
            cancelled = true;
        }
    }

    function _close(uint256 id, Policy storage p, uint256 delay, bool cancelled, bytes32 responseId) internal {
        uint256 payout;
        Status next;
        if (cancelled || delay >= FULL_PAYOUT_DELAY) {
            payout = p.coverage;
            next = Status.PaidFull;
        } else if (delay >= HALF_PAYOUT_DELAY) {
            payout = p.coverage / 2;
            next = Status.PaidHalf;
        } else {
            next = Status.ClosedNoPayout;
        }

        p.status = next;
        reserved -= p.coverage;
        if (payout > 0) token.safeTransfer(p.holder, payout);
        emit Settled(id, next, delay / 60, cancelled, payout, responseId);
    }

    /// @notice Close a policy that got no qualifying evidence within the settlement window.
    function expire(uint256 id) external {
        Policy storage p = _policies[id];
        if (p.status != Status.Active) revert NotActive(id);
        uint256 until = uint256(p.scheduledArrival) + SETTLEMENT_WINDOW;
        if (block.timestamp <= until) revert WindowOpen(until);
        p.status = Status.Expired;
        reserved -= p.coverage;
        emit Expired(id);
    }

    function fundPool(uint256 amount) external {
        token.safeTransferFrom(msg.sender, address(this), amount);
        emit PoolFunded(msg.sender, amount);
    }

    // ---------------------------------------------------------------- admin (hackathon: owner key)

    function setParams(uint16 premiumBps_, uint32 defaultMaxAge_, uint128 maxCoverage_) external onlyOwner {
        _setParams(premiumBps_, defaultMaxAge_, maxCoverage_);
    }

    /// @notice 0 is for demos only (allows buying minutes before landing). Applies to new purchases.
    function setMinLeadTime(uint32 minLeadTime_) external onlyOwner {
        minLeadTime = minLeadTime_;
        emit MinLeadTimeUpdated(minLeadTime_);
    }

    /// @notice Owner can only withdraw capital NOT backing active policies.
    function withdrawFree(uint256 amount, address to) external onlyOwner {
        uint256 free = freeCapital();
        if (amount > free) revert Insolvent(amount, free);
        token.safeTransfer(to, amount);
    }

    // ---------------------------------------------------------------- internal

    /// @dev Takes the premium, reserves coverage and writes the fields both policy kinds share.
    function _open(uint64 scheduledArrival, uint128 coverage, address holder, bytes32 cardanoJobRef)
        internal
        returns (uint256 id, Policy storage p)
    {
        if (coverage == 0 || coverage > maxCoverage || holder == address(0)) revert BadCoverage();

        uint128 premium = quote(coverage);
        token.safeTransferFrom(msg.sender, address(this), premium);
        uint256 free = freeCapital();
        if (free < coverage) revert Insolvent(coverage, free); // premium already counted in balance
        reserved += coverage;

        id = nextId++;
        p = _policies[id];
        p.holder = holder;
        p.scheduledArrival = scheduledArrival;
        p.maxAge = defaultMaxAge;
        p.status = Status.Active;
        p.premium = premium;
        p.coverage = coverage;
        p.cardanoJobRef = cardanoJobRef;
    }


    function _setParams(uint16 premiumBps_, uint32 defaultMaxAge_, uint128 maxCoverage_) internal {
        require(premiumBps_ <= 10_000 && defaultMaxAge_ > 0);
        premiumBps = premiumBps_;
        defaultMaxAge = defaultMaxAge_;
        maxCoverage = maxCoverage_;
        emit ParamsUpdated(premiumBps_, defaultMaxAge_, maxCoverage_);
    }

    /// @dev Only [A-Z0-9], 3..8 chars: no character needs JSON escaping, so the on-chain hash matches AirnodeHub's.
    function _checkFlight(string calldata f) internal pure {
        bytes calldata b = bytes(f);
        if (b.length < 3 || b.length > 8) revert BadFlight();
        for (uint256 i; i < b.length; ++i) {
            bytes1 c = b[i];
            if (!((c >= "A" && c <= "Z") || (c >= "0" && c <= "9"))) revert BadFlight();
        }
    }

    function _checkDate(string calldata d) internal pure {
        bytes calldata b = bytes(d);
        if (b.length != 10 || b[4] != "-" || b[7] != "-") revert BadDate();
        for (uint256 i; i < 10; ++i) {
            if (i == 4 || i == 7) continue;
            if (b[i] < "0" || b[i] > "9") revert BadDate();
        }
    }

    function _eq(string memory a, string memory b) internal pure returns (bool) {
        return keccak256(bytes(a)) == keccak256(bytes(b));
    }
}
