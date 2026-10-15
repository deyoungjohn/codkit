// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// Minimal 6-decimal ERC20 (USDC-like) for tests.
contract MockERC20 {
    string public name = "Mock USD";
    string public symbol = "mUSD";
    uint8 public constant decimals = 6;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
        emit Transfer(address(0), to, amount);
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        emit Approval(msg.sender, spender, amount);
        return true;
    }

    function transfer(address to, uint256 amount) public virtual returns (bool) {
        _move(msg.sender, to, amount);
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) public virtual returns (bool) {
        uint256 a = allowance[from][msg.sender];
        if (a != type(uint256).max) allowance[from][msg.sender] = a - amount;
        _move(from, to, amount);
        return true;
    }

    function _move(address from, address to, uint256 amount) internal virtual {
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        emit Transfer(from, to, amount);
    }
}

/// Takes a 1% fee on every transfer — the escrow must reject it.
contract FeeToken is MockERC20 {
    function _move(address from, address to, uint256 amount) internal override {
        uint256 fee = amount / 100;
        balanceOf[from] -= amount;
        balanceOf[to] += amount - fee;
        emit Transfer(from, to, amount - fee);
    }
}

/// Returns false instead of reverting on transfer.
contract FalseToken is MockERC20 {
    bool public fail;

    function setFail(bool f) external {
        fail = f;
    }

    function transfer(address to, uint256 amount) public override returns (bool) {
        if (fail) return false;
        return super.transfer(to, amount);
    }
}

interface IEscrowLike {
    function release(uint256 id) external;
    function refund(uint256 id) external;
    function claim(uint256 id) external;
}

/// ERC777-style hook: on every transfer out of the escrow it tries to re-enter
/// release / refund / claim for the same deal, and records whether any succeeded.
contract ReentrantToken is MockERC20 {
    address public escrow;
    uint256 public targetId;
    uint256 public reentrySucceeded;
    uint256 public reentryAttempts;

    function arm(address escrow_, uint256 id) external {
        escrow = escrow_;
        targetId = id;
    }

    function _move(address from, address to, uint256 amount) internal override {
        super._move(from, to, amount);
        if (from == escrow && escrow != address(0)) {
            reentryAttempts++;
            try IEscrowLike(escrow).release(targetId) { reentrySucceeded++; } catch {}
            try IEscrowLike(escrow).refund(targetId) { reentrySucceeded++; } catch {}
            try IEscrowLike(escrow).claim(targetId) { reentrySucceeded++; } catch {}
        }
    }
}
