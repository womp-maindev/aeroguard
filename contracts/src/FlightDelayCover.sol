// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {AirnodeV2Attestation} from "./AirnodeV2Attestation.sol";
import {ProjectedJson} from "./ProjectedJson.sol";

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
    uint256 public reserved; // sum of coverage of Active policies
    uint256 public nextId = 1;

    mapping(uint256 => Policy) internal _policies;
    mapping(bytes32 => bool) public usedResponse; // keccak256(signature) => used

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
    event Expired(uint256 indexed id);
    event PoolFunded(address indexed from, uint256 amount);
    event ParamsUpdated(uint16 premiumBps, uint32 defaultMaxAge, uint128 maxCoverage);

    error WrongRequest(bytes32 got);
    error Stale(uint256 timestamp);
    error FromTheFuture(uint256 timestamp);
    error ObservedTooEarly(uint256 signedAt, uint256 observedAt);
    error NotFinal(string status);
    error NotActive(uint256 id);
    error ResponseReused(bytes32 responseId);
    error Insolvent(uint256 needed, uint256 free);
    error BadFlight();
    error BadDate();
    error BadCoverage();
    error WindowOpen(uint256 until);

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

    // ---------------------------------------------------------------- core

    /// @notice Buy cover for `holder`. Caller pays the premium in `token`.
    /// @param flight IATA/ICAO flight number, uppercase letters and digits only, e.g. "LH1234"
    /// @param date local departure date "YYYY-MM-DD" (as AeroDataBox dateLocal)
    function buyPolicy(
        string calldata flight,
        string calldata date,
        uint64 scheduledArrival,
        uint128 coverage,
        address holder,
        bytes32 cardanoJobRef
    ) external nonReentrant returns (uint256 id) {
        _checkFlight(flight);
        _checkDate(date);
        if (coverage == 0 || coverage > maxCoverage || holder == address(0)) revert BadCoverage();

        uint128 premium = quote(coverage);
        token.safeTransferFrom(msg.sender, address(this), premium);
        uint256 free = freeCapital();
        if (free < coverage) revert Insolvent(coverage, free); // premium already counted in balance
        reserved += coverage;

        id = nextId++;
        Policy storage p = _policies[id];
        p.holder = holder;
        p.scheduledArrival = scheduledArrival;
        p.maxAge = defaultMaxAge;
        p.status = Status.Active;
        p.premium = premium;
        p.coverage = coverage;
        p.arrivalRequestHash = requestHashFor(flight, date, true);
        p.statusRequestHash = requestHashFor(flight, date, false);
        p.cardanoJobRef = cardanoJobRef;
        p.flight = flight;
        p.date = date;

        emit PolicyBought(
            id, holder, flight, date, premium, coverage, p.arrivalRequestHash, p.statusRequestHash, cardanoJobRef
        );
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

        // 1. intended request (flight, date, operation, projection) — derived on-chain at purchase
        bool isArrival = requestHash == p.arrivalRequestHash;
        if (!isArrival && requestHash != p.statusRequestHash) revert WrongRequest(requestHash);

        // 2. expected signer (also binds timestamp + data: one edited byte changes the recovered signer)
        AirnodeV2Attestation.verify(airnode, requestHash, timestamp, data, signature);

        // 3. time: fresh enough, not from the future
        if (timestamp > block.timestamp + MAX_FUTURE_SKEW) revert FromTheFuture(timestamp);
        if (timestamp + p.maxAge < block.timestamp) revert Stale(timestamp);

        // 4. no duplicate execution
        bytes32 responseId = keccak256(signature);
        if (usedResponse[responseId]) revert ResponseReused(responseId);
        usedResponse[responseId] = true;

        // 5. decide from signed fields only
        string memory status = ProjectedJson.readString(data, "status");
        uint256 scheduled = ProjectedJson.readTimestamp(data, "scheduled");
        uint256 delay;
        bool cancelled;

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

    /// @notice Owner can only withdraw capital NOT backing active policies.
    function withdrawFree(uint256 amount, address to) external onlyOwner {
        uint256 free = freeCapital();
        if (amount > free) revert Insolvent(amount, free);
        token.safeTransfer(to, amount);
    }

    // ---------------------------------------------------------------- internal

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
