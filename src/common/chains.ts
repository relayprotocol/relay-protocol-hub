import { VmType } from "@reservoir0x/relay-protocol-sdk";

import { db } from "./db";

// VM-specific chain metadata
export type ChainMetadataBitcoinVm = {};
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
        depository: chain.depository,
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

export const getSdkChainsConfig = async () => {
  return Object.fromEntries(
    Object.values(await getChains()).map((c) => [c.id, c.vmType])
  );
};
