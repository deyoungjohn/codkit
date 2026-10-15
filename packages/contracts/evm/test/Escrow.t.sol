// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {Escrow} from "../src/Escrow.sol";
import {Reputation} from "../src/Reputation.sol";
import {MockERC20, FeeToken, FalseToken, ReentrantToken} from "./Mocks.sol";

contract EscrowTest is Test {
    Escrow escrow;
    Reputation rep;
    MockERC20 usd;

    address client = makeAddr("client");
    address provider = makeAddr("provider");
    address arbiter = makeAddr("arbiter");
    address stranger = makeAddr("stranger");

    uint256 constant AMOUNT = 25e6; // 25 USDC
    uint32 constant REVIEW = 1 days;
    bytes32 constant TERMS = keccak256("write a market report");
    bytes32 constant DELIVERY = keccak256("ipfs://bafy...report");

    function setUp() public {
        rep = new Reputation(address(this));
        escrow = new Escrow(rep);
        rep.setWriter(address(escrow), true);
        usd = new MockERC20();
        usd.mint(client, 1_000e6);
        vm.prank(client);
        usd.approve(address(escrow), type(uint256).max);
    }

    function _deadline() internal view returns (uint64) {
        return uint64(block.timestamp + 3 days);
    }

    function _funded() internal returns (uint256 id) {
        vm.prank(client);
        id = escrow.createAndFund(provider, arbiter, address(usd), AMOUNT, _deadline(), REVIEW, TERMS);
    }

    function _delivered() internal returns (uint256 id) {
        id = _funded();
        vm.prank(provider);
        escrow.deliver(id, DELIVERY);
    }

    // ------------------------------------------------------------ happy paths

    function test_createFundDeliverRelease() public {
        vm.prank(client);
        uint256 id = escrow.createDeal(provider, arbiter, address(usd), AMOUNT, _deadline(), REVIEW, TERMS);
        assertEq(id, 1);
        assertEq(uint8(escrow.getDeal(id).status), uint8(Escrow.Status.Created));

        vm.expectEmit(true, false, false, true);
        emit Escrow.Funded(id, AMOUNT);
        vm.prank(client);
        escrow.fund(id);
        assertEq(usd.balanceOf(address(escrow)), AMOUNT);

        vm.prank(provider);
        escrow.deliver(id, DELIVERY);
        Escrow.Deal memory d = escrow.getDeal(id);
        assertEq(d.deliveryHash, DELIVERY);
        assertEq(d.deliveredAt, block.timestamp);

        vm.expectEmit(true, true, false, true);
        emit Escrow.Released(id, provider, AMOUNT, client);
        vm.prank(client);
        escrow.release(id);

        assertEq(usd.balanceOf(provider), AMOUNT);
        assertEq(usd.balanceOf(address(escrow)), 0);
        assertEq(uint8(escrow.getDeal(id).status), uint8(Escrow.Status.Released));
        Reputation.Stats memory s = rep.stats(provider);
        assertEq(s.completed, 1);
        assertEq(s.volume, AMOUNT);
        assertEq(rep.score(provider), 10_000);
    }

    function test_clientCanReleaseBeforeDelivery() public {
        uint256 id = _funded();
        vm.prank(client);
        escrow.release(id);
        assertEq(usd.balanceOf(provider), AMOUNT);
    }

    function test_providerClaimsAfterReviewPeriod() public {
        uint256 id = _delivered();
        vm.prank(provider);
        vm.expectRevert(Escrow.TooEarly.selector);
        escrow.claim(id);

        vm.warp(block.timestamp + REVIEW);
        vm.prank(provider);
        escrow.claim(id);
        assertEq(usd.balanceOf(provider), AMOUNT);
    }

    function test_cancelBeforeFunding() public {
        vm.prank(client);
        uint256 id = escrow.createDeal(provider, arbiter, address(usd), AMOUNT, _deadline(), REVIEW, TERMS);
        vm.prank(client);
        escrow.cancel(id);
        vm.prank(client);
        vm.expectRevert(abi.encodeWithSelector(Escrow.WrongStatus.selector, Escrow.Status.Cancelled));
        escrow.fund(id);
    }

    // ---------------------------------------------------------------- refunds

    function test_clientRefundOnlyAfterMissedDeadline() public {
        uint256 id = _funded();
        vm.prank(client);
        vm.expectRevert(Escrow.TooEarly.selector);
        escrow.refund(id);

        vm.warp(block.timestamp + 3 days + 1);
        uint256 before = usd.balanceOf(client);
        vm.prank(client);
        escrow.refund(id);
        assertEq(usd.balanceOf(client), before + AMOUNT);
        assertEq(rep.stats(provider).refunded, 1);
        assertEq(rep.score(provider), 0);
    }

    function test_clientCannotRefundAfterDelivery() public {
        uint256 id = _delivered();
        vm.warp(block.timestamp + 30 days);
        vm.prank(client);
        vm.expectRevert(Escrow.Unauthorized.selector);
        escrow.refund(id);
    }

    function test_providerCanRefundVoluntarily() public {
        uint256 id = _delivered();
        vm.prank(provider);
        escrow.refund(id);
        assertEq(usd.balanceOf(client), 1_000e6);
    }

    function test_cannotDeliverAfterDeadline() public {
        uint256 id = _funded();
        vm.warp(block.timestamp + 3 days + 1);
        vm.prank(provider);
        vm.expectRevert(Escrow.TooLate.selector);
        escrow.deliver(id, DELIVERY);
    }

    // --------------------------------------------------------------- disputes

    function test_disputeBlocksClaimAndArbiterDecides() public {
        uint256 id = _delivered();
        vm.prank(client);
        escrow.dispute(id);
        assertEq(rep.stats(provider).disputed, 1);

        vm.warp(block.timestamp + REVIEW + 1);
        vm.prank(provider);
        vm.expectRevert(abi.encodeWithSelector(Escrow.WrongStatus.selector, Escrow.Status.Disputed));
        escrow.claim(id);

        // client can't release a disputed deal on its own
        vm.prank(client);
        vm.expectRevert(abi.encodeWithSelector(Escrow.WrongStatus.selector, Escrow.Status.Disputed));
        escrow.release(id);

        vm.prank(arbiter);
        escrow.refund(id);
        assertEq(usd.balanceOf(client), 1_000e6);
    }

    function test_arbiterCanReleaseDisputed() public {
        uint256 id = _delivered();
        vm.prank(client);
        escrow.dispute(id);
        vm.prank(arbiter);
        escrow.release(id);
        assertEq(usd.balanceOf(provider), AMOUNT);
    }

    function test_disputeWindowAndArbiterRequired() public {
        uint256 id = _delivered();
        vm.warp(block.timestamp + REVIEW);
        vm.prank(client);
        vm.expectRevert(Escrow.TooLate.selector);
        escrow.dispute(id);

        vm.prank(client);
        uint256 noArb = escrow.createAndFund(provider, address(0), address(usd), AMOUNT, _deadline(), REVIEW, TERMS);
        vm.prank(provider);
        escrow.deliver(noArb, DELIVERY);
        vm.prank(client);
        vm.expectRevert(Escrow.Unauthorized.selector);
        escrow.dispute(noArb);
    }

    // ---------------------------------------------------------- access control

    function test_strangersCannotTouchDeals() public {
        uint256 id = _funded();
        vm.startPrank(stranger);
        vm.expectRevert(Escrow.Unauthorized.selector);
        escrow.release(id);
        vm.expectRevert(Escrow.Unauthorized.selector);
        escrow.refund(id);
        vm.expectRevert(Escrow.Unauthorized.selector);
        escrow.deliver(id, DELIVERY);
        vm.expectRevert(Escrow.Unauthorized.selector);
        escrow.fund(id);
        vm.stopPrank();
    }

    function test_noDoubleSettlement() public {
        uint256 id = _funded();
        vm.prank(client);
        escrow.release(id);
        vm.prank(arbiter);
        vm.expectRevert(abi.encodeWithSelector(Escrow.WrongStatus.selector, Escrow.Status.Released));
        escrow.refund(id);
        vm.prank(client);
        vm.expectRevert(abi.encodeWithSelector(Escrow.WrongStatus.selector, Escrow.Status.Released));
        escrow.release(id);
    }

    function test_rejectsBadParams() public {
        uint64 dl = _deadline();
        vm.startPrank(client);
        vm.expectRevert(Escrow.InvalidParams.selector);
        escrow.createDeal(address(0), arbiter, address(usd), AMOUNT, dl, REVIEW, TERMS);
        vm.expectRevert(Escrow.InvalidParams.selector);
        escrow.createDeal(client, arbiter, address(usd), AMOUNT, dl, REVIEW, TERMS);
        vm.expectRevert(Escrow.InvalidParams.selector);
        escrow.createDeal(provider, arbiter, address(usd), 0, dl, REVIEW, TERMS);
        vm.expectRevert(Escrow.InvalidParams.selector);
        escrow.createDeal(provider, arbiter, address(usd), AMOUNT, uint64(block.timestamp), REVIEW, TERMS);
        vm.expectRevert(Escrow.InvalidParams.selector);
        escrow.createDeal(provider, provider, address(usd), AMOUNT, dl, REVIEW, TERMS);
        vm.stopPrank();
    }

    // ------------------------------------------------------------ token quirks

    function test_rejectsFeeOnTransferTokens() public {
        FeeToken fee = new FeeToken();
        fee.mint(client, AMOUNT);
        vm.startPrank(client);
        fee.approve(address(escrow), AMOUNT);
        vm.expectRevert(Escrow.TransferFailed.selector);
        escrow.createAndFund(provider, arbiter, address(fee), AMOUNT, _deadline(), REVIEW, TERMS);
        vm.stopPrank();
    }

    function test_revertsWhenTokenReturnsFalse() public {
        FalseToken t = new FalseToken();
        t.mint(client, AMOUNT);
        vm.startPrank(client);
        t.approve(address(escrow), AMOUNT);
        uint256 id = escrow.createAndFund(provider, arbiter, address(t), AMOUNT, _deadline(), REVIEW, TERMS);
        vm.stopPrank();
        t.setFail(true);
        vm.prank(client);
        vm.expectRevert(Escrow.TransferFailed.selector);
        escrow.release(id);
        assertEq(uint8(escrow.getDeal(id).status), uint8(Escrow.Status.Funded)); // rolled back
    }

    function test_reputationFailureNeverBlocksPayout() public {
        rep.setWriter(address(escrow), false); // record() now reverts
        uint256 id = _funded();
        vm.prank(client);
        escrow.release(id);
        assertEq(usd.balanceOf(provider), AMOUNT);
        assertEq(rep.stats(provider).completed, 0);
    }

    function test_worksWithoutReputation() public {
        Escrow bare = new Escrow(Reputation(address(0)));
        vm.startPrank(client);
        usd.approve(address(bare), AMOUNT);
        uint256 id = bare.createAndFund(provider, address(0), address(usd), AMOUNT, _deadline(), 0, TERMS);
        bare.release(id);
        vm.stopPrank();
        assertEq(usd.balanceOf(provider), AMOUNT);
    }

    // ------------------------------------------------------------------- fuzz

    /// Funds are conserved: whatever path a deal takes, client + provider end up with exactly the escrowed amount.
    function testFuzz_conservation(uint96 amount, uint8 path) public {
        amount = uint96(bound(amount, 1, 1_000e6));
        vm.prank(client);
        uint256 id = escrow.createAndFund(provider, arbiter, address(usd), amount, _deadline(), REVIEW, TERMS);
        uint256 clientBefore = usd.balanceOf(client);

        path = path % 4;
        if (path == 0) {
            vm.prank(client);
            escrow.release(id);
        } else if (path == 1) {
            vm.prank(arbiter);
            escrow.refund(id);
        } else if (path == 2) {
            vm.prank(provider);
            escrow.deliver(id, DELIVERY);
            vm.warp(block.timestamp + REVIEW);
            vm.prank(provider);
            escrow.claim(id);
        } else {
            vm.warp(block.timestamp + 4 days);
            vm.prank(client);
            escrow.refund(id);
        }
        assertEq(usd.balanceOf(address(escrow)), 0);
        assertEq(usd.balanceOf(provider) + usd.balanceOf(client) - clientBefore, amount);
    }

    // ------------------------------------------------- security review fixes

    function test_clientCanRefundUnresolvedDisputeAfterArbiterTimeout() public {
        uint256 id = _delivered();
        vm.prank(client);
        escrow.dispute(id);
        uint256 end = escrow.getDeal(id).deliveredAt + REVIEW + escrow.ARBITER_TIMEOUT();

        vm.warp(end - 1);
        vm.prank(client);
        vm.expectRevert(Escrow.TooEarly.selector);
        escrow.refund(id);

        vm.warp(end);
        uint256 before = usd.balanceOf(client);
        vm.prank(client);
        escrow.refund(id);
        assertEq(usd.balanceOf(client) - before, AMOUNT);
        assertEq(uint8(escrow.getDeal(id).status), uint8(Escrow.Status.Refunded));
        assertEq(rep.stats(provider).refunded, 1);
    }

    function test_arbiterCanStillDecideBeforeTimeout() public {
        uint256 id = _delivered();
        vm.prank(client);
        escrow.dispute(id);
        vm.warp(block.timestamp + 10 days);
        vm.prank(arbiter);
        escrow.release(id);
        assertEq(usd.balanceOf(provider), AMOUNT);
    }

    function test_clientCannotRefundDeliveredDeal() public {
        uint256 id = _delivered();
        vm.warp(block.timestamp + 365 days);
        vm.prank(client);
        vm.expectRevert(Escrow.Unauthorized.selector);
        escrow.refund(id);
    }

    function test_reviewPeriodBounds() public {
        uint32 max = escrow.MAX_REVIEW_PERIOD();
        vm.startPrank(client);
        vm.expectRevert(Escrow.InvalidParams.selector);
        escrow.createDeal(provider, arbiter, address(usd), AMOUNT, _deadline(), max + 1, TERMS);
        vm.expectRevert(Escrow.InvalidParams.selector); // an arbiter with no review window could never be used
        escrow.createDeal(provider, arbiter, address(usd), AMOUNT, _deadline(), 0, TERMS);
        escrow.createDeal(provider, address(0), address(usd), AMOUNT, _deadline(), 0, TERMS); // fine without an arbiter
        escrow.createDeal(provider, arbiter, address(usd), AMOUNT, _deadline(), max, TERMS);
        vm.stopPrank();
    }

    function test_cannotFundAfterDeadline() public {
        vm.prank(client);
        uint256 id = escrow.createDeal(provider, arbiter, address(usd), AMOUNT, _deadline(), REVIEW, TERMS);
        vm.warp(escrow.getDeal(id).deadline + 1);
        vm.prank(client);
        vm.expectRevert(Escrow.TooLate.selector);
        escrow.fund(id);
    }

    function test_payoutToCodelessTokenFails() public {
        uint256 id = _funded();
        vm.etch(address(usd), ""); // token code gone: transfers must fail loudly, not "succeed" silently
        vm.prank(client);
        vm.expectRevert(Escrow.TransferFailed.selector);
        escrow.release(id);
    }

    function test_reentrantTokenCannotDoublePay() public {
        ReentrantToken t = new ReentrantToken();
        t.mint(client, AMOUNT);
        vm.startPrank(client);
        t.approve(address(escrow), AMOUNT);
        uint256 id = escrow.createAndFund(provider, arbiter, address(t), AMOUNT, _deadline(), REVIEW, TERMS);
        vm.stopPrank();
        t.arm(address(escrow), id);

        vm.prank(client);
        escrow.release(id);
        assertGt(t.reentryAttempts(), 0);
        assertEq(t.reentrySucceeded(), 0, "re-entry must fail");
        assertEq(t.balanceOf(provider), AMOUNT);
        assertEq(t.balanceOf(address(escrow)), 0);
    }
}

contract ReputationTest is Test {
    Reputation rep;
    address writer = makeAddr("writer");
    address subject = makeAddr("subject");

    function setUp() public {
        rep = new Reputation(address(this));
        rep.setWriter(writer, true);
    }

    function test_onlyWritersRecord() public {
        vm.expectRevert(Reputation.NotWriter.selector);
        rep.record(subject, address(1), Reputation.Outcome.Completed, 1, bytes32(0));
    }

    function test_onlyOwnerAdmin() public {
        vm.prank(writer);
        vm.expectRevert(Reputation.NotOwner.selector);
        rep.setWriter(writer, false);
        rep.transferOwnership(writer);
        assertEq(rep.owner(), address(this), "two-step: owner unchanged until accepted");
        assertEq(rep.pendingOwner(), writer);
        vm.prank(subject);
        vm.expectRevert(Reputation.NotOwner.selector);
        rep.acceptOwnership();
        vm.prank(writer);
        rep.acceptOwnership();
        assertEq(rep.owner(), writer);
        assertEq(rep.pendingOwner(), address(0));
    }

    function test_cannotRenounceToZero() public {
        vm.expectRevert(Reputation.ZeroAddress.selector);
        new Reputation(address(0));
        rep.transferOwnership(address(0)); // cancels a pending transfer; nobody can accept it
        vm.prank(address(0));
        vm.expectRevert(Reputation.NotOwner.selector);
        rep.acceptOwnership();
        assertEq(rep.owner(), address(this));
    }

    function test_score() public {
        vm.startPrank(writer);
        for (uint256 i; i < 3; i++) {
            rep.record(subject, address(1), Reputation.Outcome.Completed, 10, bytes32(i));
        }
        rep.record(subject, address(1), Reputation.Outcome.Refunded, 10, bytes32(uint256(9)));
        vm.stopPrank();
        assertEq(rep.score(subject), 7_500);
        assertEq(rep.stats(subject).volume, 30);
    }

    function test_volumeSaturates() public {
        vm.startPrank(writer);
        rep.record(subject, address(1), Reputation.Outcome.Completed, type(uint256).max, 0);
        rep.record(subject, address(1), Reputation.Outcome.Completed, 1, 0);
        vm.stopPrank();
        assertEq(rep.stats(subject).volume, type(uint128).max);
    }
}
