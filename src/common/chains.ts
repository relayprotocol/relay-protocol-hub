import { VmType } from "@reservoir0x/relay-protocol-sdk";

// For "ethereum-vm" allocator logic
import { privateKeyToAccount } from "viem/accounts";

// For "solana-vm" allocator logic
import { Keypair } from "@solana/web3.js";
import bs58 from "bs58";

// For "bitcoin-vm" allocator logic
import * as bitcoin from "bitcoinjs-lib";
import { ECPairFactory } from "ecpair";
import * as ecc from "tiny-secp256k1";

// For "tron-vm" allocator logic
import TronWeb from "tronweb";

import { db } from "./db";
import { externalError } from "./error";
import { config } from "../config";
import * as onchainAllocator from "../utils/onchain-allocator";

// Global chain metadata
export type ChainMetadata = {
  // The numeric chain id in the onchain allocator contract
  allocatorChainId?: string;
};

// VM-specific chain metadata
export type ChainMetadataBitcoinVm = ChainMetadata & {};
export type ChainMetadataEthereumVm = ChainMetadata & { chainId: number };
export type ChainMetadataHyperliquidVm = ChainMetadata & {};
export type ChainMetadataSolanaVm = ChainMetadata & {};
export type ChainMetadataSuiVm = ChainMetadata & {};
export type ChainMetadataTronVm = ChainMetadata & { chainId: number };
export type ChainMetadataTonVm = ChainMetadata & {};

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

export const getOnchainAllocatorForChain = async (chainId: string) => {
  return onchainAllocator.getSigner(chainId);
};

export const getOffchainAllocatorForChain = async (chainId: string) => {
  const ecdsaPk = config.ecdsaPrivateKey;
  const ed25519Pk = config.ed25519PrivateKey;

  const chain = await getChain(chainId);
  switch (chain.vmType) {
    case "ethereum-vm": {
      return privateKeyToAccount(ecdsaPk as any).address.toLowerCase();
    }

    case "solana-vm": {
      return Keypair.fromSecretKey(bs58.decode(ed25519Pk)).publicKey.toBase58();
    }

    case "bitcoin-vm": {
      const keyPair = ECPairFactory(ecc).fromPrivateKey(
        Buffer.from(
          ecdsaPk.startsWith("0x") ? ecdsaPk.slice(2) : ecdsaPk,
          "hex"
        )
      );

      const { address } = bitcoin.payments.p2wpkh({
        pubkey: Buffer.from(keyPair.publicKey),
        network: bitcoin.networks.bitcoin,
      });
      if (!address) {
        throw new Error("Failed to retrieve address");
      }

      return address;
    }

    case "tron-vm": {
      const address = TronWeb.utils.address.fromPrivateKey(
        ecdsaPk.startsWith("0x") ? ecdsaPk.slice(2) : ecdsaPk
      );
      if (!address) {
        throw new Error("Failed to retrieve address");
      }

      return address;
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
