# @codkit/contracts changelog

## 0.1.1 (2026-10-16)

**Security review fixes**, from [the review](https://github.com/deyoungjohn/codkit/blob/main/docs/security/escrow-review.md). These change behavior, so read them before upgrading a deployment:

- **Arbiter timeout:** the client can refund a dispute that's still unresolved `ARBITER_TIMEOUT` (30 days) after the review period ends. Before, funds stayed locked if the arbiter never acted.
- **Review period:** at most `MAX_REVIEW_PERIOD` (30 days), and above zero when there's an arbiter.
- **EVM `fund`:** reverts with `TooLate` after the deadline.
- **EVM `Reputation`:** ownership now transfers in two steps (`transferOwnership` → `acceptOwnership`), and the zero address is rejected. The ABI adds `pendingOwner`, `acceptOwnership` and `OwnershipTransferStarted`.
- **EVM events:** `Released`, `Refunded` and `Disputed` are now emitted before the external calls.

**New:**

- **Solana:** the `kit_escrow` Anchor program, plus `@codkit/contracts/solana`, a client built on `@solana/kit` (optional peer). It includes instruction builders, address derivation, account decoders and `solanaEscrowCreateAction` for `@codkit/policy`.
- **`deployments`:** now covers the redeployed Base Sepolia contracts, the Sui testnet package `0x9bc0…3944` and the Solana devnet program `8kQB…WMkX`. The pre-review addresses are gone.

## 0.1.0 (2026-10-15)

First release: EVM (Foundry) and Sui Move escrow and reputation, with viem and Sui bindings.
