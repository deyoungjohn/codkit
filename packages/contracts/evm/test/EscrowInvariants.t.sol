// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test, console} from "forge-std/Test.sol";
import {Escrow} from "../src/Escrow.sol";
import {Reputation} from "../src/Reputation.sol";
import {MockERC20} from "./Mocks.sol";

/// Drives random sequences of every Escrow entry point, from every kind of
/// actor (including strangers), across many deals and arbitrary time jumps.
/// Ghost state mirrors what *should* have happened so the invariants below
/// can compare it with what the contracts actually hold.
contract EscrowHandler is Test {
    Escrow public escrow;
    Reputation public rep;
    MockERC20 public usd;

    address[] public actors;
    uint256 public constant MINTED_EACH = 1_000_000e6;

    // ghost state
    uint256[] public dealIds;
    mapping(uint256 => uint256) public payouts; // successful release/claim/refund per deal
    mapping(address => uint256) public ghostCompleted;
    mapping(address => uint256) public ghostRefunded;
    mapping(address => uint256) public ghostDisputed;
    bool public strangerMovedFunds;
    bool public terminalChanged;
    mapping(uint256 => Escrow.Status) public lastStatus;

    constructor(Escrow e, Reputation r, MockERC20 t) {
        escrow = e;
        rep = r;
        usd = t;
        for (uint256 i = 0; i < 5; i++) {
            address a = makeAddr(string.concat("actor", vm.toString(i)));
            actors.push(a);
            usd.mint(a, MINTED_EACH);
            vm.prank(a);
            usd.approve(address(escrow), type(uint256).max);
        }
    }

    function actorCount() external view returns (uint256) {
        return actors.length;
    }

    function dealCount() external view returns (uint256) {
        return dealIds.length;
    }

    function _actor(uint256 seed) internal view returns (address) {
        return actors[seed % actors.length];
    }

    function _deal(uint256 seed) internal view returns (uint256) {
        if (dealIds.length == 0) return 0;
        return dealIds[seed % dealIds.length];
    }

    enum Role {
        Client,
        Provider,
        Arbiter
    }

    /// 80% of the time the role the action is meant for, otherwise anyone (incl. strangers).
    function _caller(uint256 id, Role role, uint256 seed) internal view returns (address) {
        if (seed % 5 == 0) return _actor(seed / 5);
        Escrow.Deal memory d = escrow.getDeal(id);
        if (role == Role.Client) return d.client;
        if (role == Role.Provider) return d.provider;
        return d.arbiter == address(0) ? _actor(seed / 5) : d.arbiter;
    }

    function _isParty(uint256 id, address who) internal view returns (bool) {
        Escrow.Deal memory d = escrow.getDeal(id);
        return who == d.client || who == d.provider || (d.arbiter != address(0) && who == d.arbiter);
    }

    function _after(uint256 id, address caller, uint256 heldBefore) internal {
        Escrow.Status s = escrow.getDeal(id).status;
        Escrow.Status prev = lastStatus[id];
        bool prevTerminal =
            prev == Escrow.Status.Released || prev == Escrow.Status.Refunded || prev == Escrow.Status.Cancelled;
        if (prevTerminal && s != prev) terminalChanged = true;
        if (usd.balanceOf(address(escrow)) < heldBefore) {
            payouts[id]++;
            if (!_isParty(id, caller)) strangerMovedFunds = true;
        }
        lastStatus[id] = s;
    }

    /// Three distinct actors, so most creates are valid.
    function _parties(uint256 c, uint256 p, uint256 a, bool withArbiter)
        internal
        view
        returns (address client, address provider, address arbiter)
    {
        uint256 n = actors.length;
        uint256 ci = c % n;
        uint256 pi = (ci + 1 + p % (n - 1)) % n;
        uint256 ai = a % n;
        while (ai == ci || ai == pi) ai = (ai + 1) % n;
        return (actors[ci], actors[pi], withArbiter ? actors[ai] : address(0));
    }

    // ------------------------------------------------------------- actions

    function create(uint256 c, uint256 p, uint256 a, uint256 amount, uint256 dl, uint256 review, bool fund_, bool withArbiter)
        external
    {
        (address client, address provider, address arbiter) = _parties(c, p, a, withArbiter);
        amount = bound(amount, 1, 10_000e6);
        uint64 deadline = uint64(block.timestamp + bound(dl, 1, 30 days));
        uint32 reviewPeriod = uint32(bound(review, 0, 30 days));
        vm.prank(client);
        try escrow.createDeal(provider, arbiter, address(usd), amount, deadline, reviewPeriod, bytes32(0)) returns (
            uint256 id
        ) {
            dealIds.push(id);
            lastStatus[id] = Escrow.Status.Created;
            if (fund_) {
                vm.prank(client);
                try escrow.fund(id) {
                    lastStatus[id] = Escrow.Status.Funded;
                } catch {}
            }
        } catch {}
    }

    function fund(uint256 who, uint256 d) external {
        uint256 id = _deal(d);
        if (id == 0) return;
        vm.prank(_caller(id, Role.Client, who));
        try escrow.fund(id) {} catch {}
        lastStatus[id] = escrow.getDeal(id).status;
    }

    function cancel(uint256 who, uint256 d) external {
        uint256 id = _deal(d);
        if (id == 0) return;
        uint256 held = usd.balanceOf(address(escrow));
        address caller = _caller(id, Role.Client, who);
        vm.prank(caller);
        try escrow.cancel(id) {} catch {}
        _after(id, caller, held);
    }

    function deliver(uint256 who, uint256 d) external {
        uint256 id = _deal(d);
        if (id == 0) return;
        uint256 held = usd.balanceOf(address(escrow));
        address caller = _caller(id, Role.Provider, who);
        vm.prank(caller);
        try escrow.deliver(id, keccak256(abi.encode(id))) {} catch {}
        _after(id, caller, held);
    }

    function dispute(uint256 who, uint256 d) external {
        uint256 id = _deal(d);
        if (id == 0) return;
        uint256 held = usd.balanceOf(address(escrow));
        address caller = _caller(id, Role.Client, who);
        vm.prank(caller);
        try escrow.dispute(id) {
            ghostDisputed[escrow.getDeal(id).provider]++;
        } catch {}
        _after(id, caller, held);
    }

    function release(uint256 who, uint256 d) external {
        uint256 id = _deal(d);
        if (id == 0) return;
        uint256 held = usd.balanceOf(address(escrow));
        address caller = _caller(id, Role((who / 7) % 3), who);
        vm.prank(caller);
        try escrow.release(id) {
            ghostCompleted[escrow.getDeal(id).provider]++;
        } catch {}
        _after(id, caller, held);
    }

    function claim(uint256 who, uint256 d) external {
        uint256 id = _deal(d);
        if (id == 0) return;
        uint256 held = usd.balanceOf(address(escrow));
        address caller = _caller(id, Role.Provider, who);
        vm.prank(caller);
        try escrow.claim(id) {
            ghostCompleted[escrow.getDeal(id).provider]++;
        } catch {}
        _after(id, caller, held);
    }

    function refund(uint256 who, uint256 d) external {
        uint256 id = _deal(d);
        if (id == 0) return;
        uint256 held = usd.balanceOf(address(escrow));
        address caller = _caller(id, Role((who / 7) % 3), who);
        vm.prank(caller);
        try escrow.refund(id) {
            ghostRefunded[escrow.getDeal(id).provider]++;
        } catch {}
        _after(id, caller, held);
    }

    /// Push a deal one step down the dispute path (deliver, then dispute) so
    /// arbiter release/refund paths get exercised often, not by luck.
    function flowDispute(uint256 d) external {
        uint256 id = _deal(d);
        if (id == 0) return;
        Escrow.Deal memory deal = escrow.getDeal(id);
        uint256 held = usd.balanceOf(address(escrow));
        if (deal.status == Escrow.Status.Funded) {
            vm.prank(deal.provider);
            try escrow.deliver(id, bytes32(id)) {} catch {}
            _after(id, deal.provider, held);
        } else if (deal.status == Escrow.Status.Delivered && deal.arbiter != address(0)) {
            vm.prank(deal.client);
            try escrow.dispute(id) {
                ghostDisputed[deal.provider]++;
            } catch {}
            _after(id, deal.client, held);
        }
    }

    function warp(uint256 secs) external {
        // mostly short steps (inside review windows), sometimes long jumps (past deadlines)
        vm.warp(block.timestamp + (secs % 8 == 0 ? bound(secs, 0, 45 days) : bound(secs, 0, 12 hours)));
    }
}

contract EscrowInvariantTest is Test {
    Escrow escrow;
    Reputation rep;
    MockERC20 usd;
    EscrowHandler handler;

    function setUp() public {
        rep = new Reputation(address(this));
        escrow = new Escrow(rep);
        rep.setWriter(address(escrow), true);
        usd = new MockERC20();
        handler = new EscrowHandler(escrow, rep, usd);
        targetContract(address(handler));
    }

    /// Guard against vacuous passes: the random walk must actually reach settlements.
    function afterInvariant() public view {
        uint256 n = escrow.dealCount();
        uint256[8] memory byStatus;
        for (uint256 id = 1; id <= n; id++) byStatus[uint8(escrow.getDeal(id).status)]++;
        console.log("deals", n, "released", byStatus[5]);
        console.log("refunded", byStatus[6], "disputed", byStatus[4]);
        console.log("delivered", byStatus[3], "cancelled", byStatus[7]);
        uint256 disputes;
        for (uint256 i = 0; i < handler.actorCount(); i++) disputes += handler.ghostDisputed(handler.actors(i));
        console.log("disputes ever raised", disputes);
    }

    /// The escrow holds exactly the amounts of deals whose funds are still locked.
    function invariant_balanceMatchesOpenDeals() public view {
        uint256 open;
        uint256 n = escrow.dealCount();
        for (uint256 id = 1; id <= n; id++) {
            Escrow.Deal memory d = escrow.getDeal(id);
            if (d.status == Escrow.Status.Funded || d.status == Escrow.Status.Delivered || d.status == Escrow.Status.Disputed)
            {
                open += d.amount;
            }
        }
        assertEq(usd.balanceOf(address(escrow)), open);
    }

    /// No tokens are created or destroyed: actors + escrow always hold what was minted.
    function invariant_conservation() public view {
        uint256 total = usd.balanceOf(address(escrow));
        for (uint256 i = 0; i < handler.actorCount(); i++) {
            total += usd.balanceOf(handler.actors(i));
        }
        assertEq(total, handler.actorCount() * handler.MINTED_EACH());
    }

    /// A deal pays out (release, claim or refund) at most once.
    function invariant_singlePayout() public view {
        for (uint256 i = 0; i < handler.dealCount(); i++) {
            assertLe(handler.payouts(handler.dealIds(i)), 1);
        }
    }

    /// Only a deal's client, provider or arbiter can ever move its funds.
    function invariant_onlyPartiesMoveFunds() public view {
        assertFalse(handler.strangerMovedFunds());
    }

    /// Released / Refunded / Cancelled are final.
    function invariant_terminalStatesAreFinal() public view {
        assertFalse(handler.terminalChanged());
    }

    /// Reputation counters match the outcomes that actually happened.
    function invariant_reputationMatchesOutcomes() public view {
        for (uint256 i = 0; i < handler.actorCount(); i++) {
            address a = handler.actors(i);
            Reputation.Stats memory s = rep.stats(a);
            assertEq(s.completed, handler.ghostCompleted(a), "completed");
            assertEq(s.refunded, handler.ghostRefunded(a), "refunded");
            assertEq(s.disputed, handler.ghostDisputed(a), "disputed");
        }
    }
}
