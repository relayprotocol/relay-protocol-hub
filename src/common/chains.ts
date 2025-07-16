import { VmType } from "@reservoir0x/relay-protocol-sdk";

// For "ethereum-vm" allocator logic
import { privateKeyToAccount } from "viem/accounts";

// For "solana-vm" allocator logic
import { Keypair } from "@solana/web3.js";
import bs58 from "bs58";

import { db } from "./db";
import { config } from "../config";
import { externalError } from "./error";

// VM-specific chain metadata
export type ChainMetadataBitcoinVm = { httpRpcUrl: string };
export type ChainMetadataEthereumVm = { chainId: number };
export type ChainMetadataHyperliquidVm = {};
export type ChainMetadataSolanaVm = {};
export type ChainMetadataSuiVm = {};
export type ChainMetadataTronVm = {};
export type ChainMetadataTonVm = {};

export type Chain = {
  id: string;
  vmType: VmType;
  depository?: string;
  metadata:
    | ChainMetadataBitcoinVm
    | ChainMetadataEthereumVm
    | ChainMetadataHyperliquidVm
    | ChainMetadataSolanaVm
    | ChainMetadataSuiVm
    | ChainMetadataTronVm
    | ChainMetadataTonVm;
};

let _chains: { [id: string]: Chain } | undefined;
export const getChains = async () => {
  if (!_chains) {
    const __chains: { [id: string]: Chain } = {};

    const chains = await db.manyOrNone("SELECT * FROM chains");
    for (const chain of chains) {
      __chains[chain.id] = {
        id: chain.id,
        vmType: chain.vm_type,
        depository: chain.depository ?? undefined,
        metadata: chain.metadata,
      };
    }

    _chains = __chains;
  }

  return _chains;
};

export const getChain = async (chainId: string) => {
  const chains = await getChains();
  if (!chains[chainId]) {
    throw new Error(`Chain ${chainId} not available`);
  }

  return chains[chainId];
};

export const getAllocatorForChain = async (chainId: string) => {
  const chain = await getChain(chainId);
  switch (chain.vmType) {
    case "ethereum-vm": {
      return privateKeyToAccount(
        config.ecdsaPrivateKey as any
      ).address.toLowerCase();
    }

    case "solana-vm": {
      return Keypair.fromSecretKey(
        bs58.decode(config.ed25519PrivateKey)
      ).publicKey.toBase58();
    }

    default: {
      throw externalError("Vm type not implemented");
    }
  }
};

export const getSdkChainsConfig = async () => {
  return Object.fromEntries(
    Object.values(await getChains()).map((c) => [c.id, c.vmType])
  );
};
