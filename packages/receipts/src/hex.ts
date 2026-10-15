import { bytesToHex, hexToBytes as nobleHexToBytes } from "@noble/hashes/utils.js";

export const toHex = (b: Uint8Array): `0x${string}` => `0x${bytesToHex(b)}`;
export const fromHex = (h: string): Uint8Array => nobleHexToBytes(h.startsWith("0x") ? h.slice(2) : h);
