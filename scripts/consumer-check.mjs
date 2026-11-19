#!/usr/bin/env node
/**
 * Prove other repos can build against codkit's contracts, the way a hackathon project would:
 *
 *   evm     a Foundry project runs `forge install <repo>` and imports "codkit/Escrow.sol"
 *   solana  an Anchor program depends on `kit_escrow` through a cargo git dependency and CPIs into it
 *   sui     a Move package depends on `kit_escrow` through a git dependency with `subdir`
 *           (and, on testnet, links to codkit's published package)
 *
 *   node scripts/consumer-check.mjs [--only evm,solana,sui] [--repo <git url>] [--rev <commit|branch>]
 *
 * Defaults: this checkout (file://) at HEAD, so it checks committed code before it is pushed.
 * Use `--repo https://github.com/deyoungjohn/codkit --rev main` for the published repo.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const arg = (n) => {
  const i = process.argv.indexOf(`--${n}`);
  return i > 0 ? process.argv[i + 1] : undefined;
};
const repo = arg("repo") ?? `file://${root}`;
const rev = arg("rev") ?? execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
const only = (arg("only") ?? "evm,solana,sui").split(",");
const SUI_PUBLISHED = "0x9bc025aaff8b63103a4cea136304c11267af7816e0ae2b8eeeb51bea99293944";

const write = (dir, files) => {
  for (const [path, body] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), body);
  }
};
const sh = (cwd, cmd, args) => execFileSync(cmd, args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 64 << 20 });

const checks = {
  evm(dir) {
    write(dir, {
      "foundry.toml": '[profile.default]\nsrc = "src"\nout = "out"\nlibs = ["lib"]\n',
      "src/Shop.sol": `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Escrow} from "codkit/Escrow.sol";
import {Reputation} from "codkit/Reputation.sol";

contract Shop {
    Escrow public immutable escrow;

    constructor(Escrow e) {
        escrow = e;
    }

    function reputation() external view returns (Reputation) {
        return escrow.reputation();
    }
}
`,
      "script/Deploy.s.sol": `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {DeploymentRecorder} from "codkit/DeploymentRecorder.sol";
import {Escrow} from "codkit/Escrow.sol";
import {Shop} from "../src/Shop.sol";

contract Deploy is DeploymentRecorder {
    function run() external {
        vm.startBroadcast();
        Shop shop = new Shop(Escrow(address(0x1234)));
        vm.stopBroadcast();
        record("Shop", address(shop));
    }
}
`,
    });
    sh(dir, "git", ["init", "-q"]);
    const gh = /^https:\/\/github\.com\/([^/]+\/[^/.]+)/.exec(repo);
    if (gh) sh(dir, "forge", ["install", "--quiet", `${gh[1]}@${rev}`]);
    else {
      // what `forge install` does, for a local checkout it can't name (it reads non-URLs as GitHub shorthand)
      const git = (...a) => sh(dir, "git", ["-c", "protocol.file.allow=always", ...a]);
      git("submodule", "add", "--quiet", repo, "lib/codkit");
      git("-C", "lib/codkit", "checkout", "--quiet", rev);
      git("submodule", "update", "--init", "--recursive", "--quiet");
    }
    const remap = sh(dir, "forge", ["remappings"]);
    if (!/^codkit\/=lib\/codkit\/packages\/contracts\/evm\/src\/$/m.test(remap)) throw new Error(`unexpected remappings:\n${remap}`);
    sh(dir, "forge", ["build"]);
    return 'forge install + import "codkit/Escrow.sol" + DeploymentRecorder build';
  },

  solana(dir) {
    write(dir, {
      "Cargo.toml": `[package]
name = "marketplace"
version = "0.1.0"
edition = "2021"

[lib]
crate-type = ["cdylib", "lib"]

[features]
cpi = ["no-entrypoint"]
no-entrypoint = []

[dependencies]
anchor-lang = "1.2.1"
kit_escrow = { git = "${repo}", rev = "${rev}", features = ["cpi"] }
`,
      "src/lib.rs": `use anchor_lang::prelude::*;
use kit_escrow::program::KitEscrow;
use kit_escrow::state::Deal;

declare_id!("11111111111111111111111111111112");

#[program]
pub mod marketplace {
    use super::*;

    pub fn deliver_order(ctx: Context<DeliverOrder>, delivery_hash: [u8; 32]) -> Result<()> {
        require_keys_eq!(ctx.accounts.deal.provider, ctx.accounts.provider.key());
        let cpi = CpiContext::new(
            ctx.accounts.escrow_program.key(),
            kit_escrow::cpi::accounts::Deliver {
                provider: ctx.accounts.provider.to_account_info(),
                deal: ctx.accounts.deal.to_account_info(),
            },
        );
        kit_escrow::cpi::deliver(cpi, delivery_hash)
    }
}

#[derive(Accounts)]
pub struct DeliverOrder<'info> {
    pub provider: Signer<'info>,
    #[account(mut)]
    pub deal: Account<'info, Deal>,
    pub escrow_program: Program<'info, KitEscrow>,
}
`,
      "rust-toolchain.toml": '[toolchain]\nchannel = "1.99.1"\nprofile = "minimal"\n',
    });
    sh(dir, "cargo", ["check", "--quiet"]);
    return "cargo git dependency + CPI into kit_escrow::deliver";
  },

  sui(dir) {
    write(dir, {
      "Move.toml": `[package]
name = "shop"
edition = "2024"

[dependencies]
kit_escrow = { git = "${repo}", subdir = "packages/contracts/sui", rev = "${rev}" }

[addresses]
shop = "0x0"
`,
      "sources/shop.move": `module shop::shop;

use kit_escrow::reputation::{Self, Reputation};

public fun is_trusted(rep: &Reputation, seller: address, min_completed: u64): bool {
    reputation::completed(&reputation::stats(rep, seller)) >= min_completed
}
`,
    });
    const out = sh(dir, "sui", ["move", "build", "-e", "testnet", "--dump-bytecode-as-base64"]);
    const { dependencies } = JSON.parse(out.trim().split("\n").at(-1));
    if (!dependencies.includes(SUI_PUBLISHED))
      throw new Error(`did not link to codkit's published package ${SUI_PUBLISHED}: ${dependencies}`);
    return `Move git dependency (subdir) linking to published ${SUI_PUBLISHED.slice(0, 10)}…`;
  },
};

console.log(`consumer check against ${repo} @ ${rev.slice(0, 12)}`);
let failed = 0;
for (const name of only) {
  const dir = mkdtempSync(join(tmpdir(), `codkit-consumer-${name}-`));
  process.stdout.write(`• ${name} … `);
  const t = Date.now();
  try {
    console.log(`ok — ${checks[name](dir)} (${Math.round((Date.now() - t) / 1000)}s)`);
  } catch (e) {
    failed++;
    console.log(
      `FAILED\n${String(e.stderr || e.stdout || e.message)
        .trim()
        .split("\n")
        .slice(-15)
        .join("\n")}`,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
process.exitCode = failed ? 1 : 0;
