import { VmType } from "@reservoir0x/relay-protocol-sdk";

import { db } from "./db";

export type Chain = {
  id: number;
  name: string;
  vmType: VmType;
};

let _chains: { [id: number]: Chain } | undefined;
export const getChains = async () => {
  if (!_chains) {
    const __chains: { [id: number]: Chain } = {};

    const chains = await db.manyOrNone("SELECT * FROM chains");
    for (const chain of chains) {
      __chains[chain.id] = {
        id: Number(chain.id),
        name: chain.name,
        vmType: chain.vm_type,
      };
    }

    _chains = __chains;
  }

  return _chains;
};

export const getChain = async (chainId: number) => {
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
