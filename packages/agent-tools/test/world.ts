import { type AnyKitTool, callTool } from "@codkit/mcp";
import { type Approver, createPolicyEngine, type PolicyInput, toAtomic } from "@codkit/policy";
import { type Address, encodeFunctionData, erc20Abi, parseEther } from "viem";
import { evmChain, type EvmSwapProvider } from "../src/evm.js";
import { agentTools } from "../src/index.js";
import { startAnvil } from "./anvil.js";
import { testRouterAbi, testRouterBytecode, testTokenAbi, testTokenBytecode } from "./mocks.js";

export const tusd = (v: string) => toAtomic(v, 6);

/** A local Anvil with two test tokens and a toy router, plus helpers to build the tools against it. */
export async function createWorld() {
  const chain = await startAnvil();
  const deploy = async (abi: typeof testTokenAbi | typeof testRouterAbi, bytecode: `0x${string}`) => {
    const hash = await chain.deployer.deployContract({ abi, bytecode });
    return (await chain.publicClient.waitForTransactionReceipt({ hash })).contractAddress as Address;
  };
  const TUSD = await deploy(testTokenAbi, testTokenBytecode);
  const TOKB = await deploy(testTokenAbi, testTokenBytecode);
  const ROUTER = await deploy(testRouterAbi, testRouterBytecode);
  const mint = await chain.deployer.writeContract({
    address: TUSD,
    abi: testTokenAbi,
    functionName: "mint",
    args: [chain.agent.account.address, tusd("1000")],
  });
  await chain.publicClient.waitForTransactionReceipt({ hash: mint });

  /** A toy venue: 1:1 in value at `ratePct` percent, executed by the TestRouter. */
  const toyProvider = (name: string, ratePct = 100n): EvmSwapProvider => ({
    name,
    supports: (id) => id === 31337,
    async quote({ from, to, amount, account, slippageBps }) {
      if (ratePct === 0n) throw new Error(`${name} has no route`);
      const out = (((amount * 10n ** BigInt(to.decimals)) / 10n ** BigInt(from.decimals)) * ratePct) / 100n;
      const min = (out * BigInt(10_000 - slippageBps)) / 10_000n;
      if (from.address === "native") {
        return {
          expected: out,
          min,
          tx: {
            to: ROUTER,
            value: amount,
            data: encodeFunctionData({ abi: testRouterAbi, functionName: "swapNative", args: [to.address as Address, out, account] }),
          },
        };
      }
      return {
        expected: out,
        min,
        spender: ROUTER,
        tx: {
          to: ROUTER,
          data: encodeFunctionData({
            abi: testRouterAbi,
            functionName: "swap",
            args: [from.address as Address, amount, to.address as Address, out, account],
          }),
        },
      };
    },
  });

  const basePolicy = (): PolicyInput => ({
    chains: ["eip155:31337"],
    limits: [
      { asset: TUSD, label: "TUSD", perTx: tusd("50"), perPeriod: { amount: tusd("100"), seconds: 3600 } },
      { asset: TOKB, label: "TOKB", perTx: tusd("50") },
      { asset: "native", label: "ETH", perTx: parseEther("1") },
    ],
  });

  const setup = (
    o: {
      policy?: PolicyInput;
      caps?: Record<string, string>;
      dryRun?: boolean;
      approver?: Approver;
      swap?: EvmSwapProvider[];
      maxSlippageBps?: number;
    } = {},
  ) => {
    const engine = createPolicyEngine({ policy: o.policy ?? basePolicy(), ...(o.approver && { approver: o.approver }) });
    const adapter = evmChain({
      chain: "anvil",
      publicClient: chain.publicClient,
      walletClient: chain.agent,
      tokens: { TUSD: { address: TUSD, decimals: 6 }, TOKB: { address: TOKB, decimals: 6 } },
      swap: o.swap ?? [toyProvider("toy")],
    });
    const tools = agentTools({
      engine,
      chains: [adapter],
      maxPerCall: o.caps ?? { ETH: "0.5", TUSD: "30", TOKB: "30" },
      ...(o.dryRun !== undefined && { dryRun: o.dryRun }),
      ...(o.maxSlippageBps !== undefined && { maxSlippageBps: o.maxSlippageBps }),
    });
    const call = async (name: string, args: unknown) => {
      const res = await callTool(tools.find((t: AnyKitTool) => t.name === name)!, args);
      return res.ok ? { ok: true as const, value: res.value as Record<string, any> } : { ok: false as const, error: res.error };
    };
    return { engine, tools, call };
  };

  const bal = (token: Address, who: Address) =>
    chain.publicClient.readContract({ address: token, abi: erc20Abi, functionName: "balanceOf", args: [who] });
  return {
    chain,
    TUSD,
    TOKB,
    ROUTER,
    toyProvider,
    basePolicy,
    setup,
    bal,
    agent: () => chain.agent.account.address,
    stop: () => chain.stop(),
  };
}
