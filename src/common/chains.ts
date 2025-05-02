import { VmType } from "@reservoir0x/relay-protocol-sdk";

import { db } from "./db";

// VM-specific chain metadata
export type ChainMetadataEthereumVm = { chainId: number };
export type ChainMetadataSolanaVm = {};
export type ChainMetadataTronVm = {};
export type ChainMetadataTonVm = {};
export type ChainMetadataSuiVm = {};

export type Chain = {
  id: string;
  vmType: VmType;
  escrow: string;
  metadata:
    | ChainMetadataEthereumVm
    | ChainMetadataSolanaVm
    | ChainMetadataTronVm
    | ChainMetadataTonVm
    | ChainMetadataSuiVm;
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
        escrow: chain.escrow,
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
