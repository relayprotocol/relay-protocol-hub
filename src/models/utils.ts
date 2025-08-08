import { VmType } from "@reservoir0x/relay-protocol-sdk";
import { PublicKey } from "@solana/web3.js";
import * as bitcoin from "bitcoinjs-lib";

import { externalError } from "../common/error";

export type DbEntry<T> = T & {
  createdAt: Date;
  updatedAt: Date;
};

// Normalize and validate bytes
export const nvBytes = (bytes: string, requiredLengthInBytes: number) => {
  if (requiredLengthInBytes % 2 !== 0) {
    throw new Error("The required length must be an even number");
  }

  let result = BigInt(bytes).toString(16).toLowerCase();

  // Enforce the required length
  if (result.length < requiredLengthInBytes * 2) {
    result = "0".repeat(requiredLengthInBytes * 2 - result.length) + result;
  }

  return "0x" + result;
};

// Normalize and validate an address
export const nvAddress = (address: string, vmType: VmType) => {
  switch (vmType) {
    case "ethereum-vm": {
      const requiredLengthInBytes = 20;

      const hexString = nvBytes(address, requiredLengthInBytes);
      if (hexString.length !== 2 + requiredLengthInBytes * 2) {
        throw externalError(`Invalid address: ${address}`);
      }

      return hexString;
    }

    case "hyperliquid-vm": {
      const requiredLengthInBytes = 20;

      const hexString = nvBytes(address, requiredLengthInBytes);
      if (hexString.length !== 2 + requiredLengthInBytes * 2) {
        throw externalError(`Invalid address: ${address}`);
      }

      return hexString;
    }

    case "solana-vm": {
      try {
        return new PublicKey(address).toBase58();
      } catch {
        throw externalError(`Invalid address: ${address}`);
      }
    }

    case "bitcoin-vm": {
      const result = validateAndNormalizeBitcoinVmAddress(address);
      if (!result) {
        throw externalError(`Invalid address: ${address}`);
      }

      return result;
    }

    default: {
      throw externalError("Vm type not implemented");
    }
  }
};

// Normalize and validate a currency
export const nvCurrency = (currency: string, vmType: VmType) => {
  switch (vmType) {
    case "ethereum-vm": {
      const requiredLengthInBytes = 20;

      const hexString = nvBytes(currency, requiredLengthInBytes);
      if (hexString.length !== 2 + requiredLengthInBytes * 2) {
        throw externalError(`Invalid currency: ${currency}`);
      }

      return hexString;
    }

    case "hyperliquid-vm": {
      const requiredLengthInBytes = 16;

      const hexString = nvBytes(currency, requiredLengthInBytes);
      if (hexString.length !== 2 + requiredLengthInBytes * 2) {
        throw externalError(`Invalid currency: ${currency}`);
      }

      return hexString;
    }

    case "solana-vm": {
      try {
        return new PublicKey(currency).toBase58();
      } catch {
        throw externalError(`Invalid currency: ${currency}`);
      }
    }

    case "bitcoin-vm": {
      const result = validateAndNormalizeBitcoinVmAddress(currency);
      if (!result) {
        throw externalError(`Invalid currency: ${currency}`);
      }

      return result;
    }

    default: {
      throw externalError("Vm type not implemented");
    }
  }
};

// Normalize and validate a transaction id
export const nvTransactionId = (transactionId: string, vmType: VmType) => {
  switch (vmType) {
    case "ethereum-vm": {
      const requiredLengthInBytes = 32;

      const hexString = nvBytes(transactionId, requiredLengthInBytes);
      if (hexString.length !== 2 + requiredLengthInBytes * 2) {
        throw externalError(`Invalid transaction id: ${transactionId}`);
      }

      return hexString;
    }

    case "hyperliquid-vm": {
      const requiredLengthInBytes = 32;

      const hexString = nvBytes(transactionId, requiredLengthInBytes);
      if (hexString.length !== 2 + requiredLengthInBytes * 2) {
        throw externalError(`Invalid transaction id: ${transactionId}`);
      }

      return hexString;
    }

    case "solana-vm": {
      return transactionId;
    }

    case "bitcoin-vm": {
      const requiredLengthInBytes = 32;
      const hexString = nvBytes(`0x${transactionId}`, requiredLengthInBytes);
      if (hexString.length !== 2 + requiredLengthInBytes * 2) {
        throw externalError(`Invalid transaction id: ${transactionId}`);
      }

      return hexString.slice(2);
    }

    default: {
      throw externalError("Vm type not implemented");
    }
  }
};

const validateAndNormalizeBitcoinVmAddress = (
  address: string
): string | undefined => {
  // Try P2PKH / P2SH (Base58Check)
  try {
    const { version } = bitcoin.address.fromBase58Check(address);
    if (
      version === bitcoin.networks.bitcoin.pubKeyHash ||
      version === bitcoin.networks.bitcoin.scriptHash
    ) {
      return address;
    }
  } catch {
    // Ignore Base58Check failure
  }

  // Try Bech32 (P2WPKH / P2WSH)
  try {
    const { prefix } = bitcoin.address.fromBech32(address);
    if (prefix === "bc") {
      return address.toLowerCase();
    }
  } catch {
    // Ignore Bech32 failure
  }

  return undefined;
};
