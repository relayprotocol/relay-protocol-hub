import { VmType } from "@reservoir0x/relay-protocol-sdk";
import { PublicKey } from "@solana/web3.js";
import { bech32, bech32m } from "bech32";
import bs58 from "bs58";

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
      try {
        // For bech32 addresses (P2WPKH)
        try {
          const decoded = bech32.decode(address);
          // Validate that it's a Bitcoin address by checking the prefix
          if (decoded.prefix !== "bc" && decoded.prefix !== "tb") {
            throw new Error("Invalid Bitcoin address prefix");
          }
          return address;
        } catch (e1) {
          // For bech32m addresses (P2TR)
          try {
            const decoded = bech32m.decode(address);
            // Validate that it's a Bitcoin address by checking the prefix
            if (decoded.prefix !== "bc" && decoded.prefix !== "tb") {
              throw new Error("Invalid Bitcoin address prefix");
            }
            return address;
          } catch (e2) {
            // For P2PKH / P2SH (base58 encoded)
            bs58.decode(address);
            
            // Validate address format
            // P2PKH starts with 1, P2SH starts with 3
            if (address.startsWith("1") || address.startsWith("3")) {
              // Additional validation: check length
              if (address.length < 26 || address.length > 35) {
                throw new Error("Invalid Bitcoin address length");
              }
              return address;
            }
            throw new Error("Invalid Bitcoin address format");
          }
        }
      } catch (e) {
        throw externalError(`Invalid address: ${address}`);
      }
    }

    default: {
      throw externalError("Vm type not implemented");
    }
  }
};

// Normalize and validate a currency
export const nvCurrency = (currency: string, vmType: VmType) => {
  switch (vmType) {

    case "bitcoin-vm":
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

      const hexString = nvBytes(transactionId, requiredLengthInBytes);
      if (hexString.length !== 2 + requiredLengthInBytes * 2) {
        throw externalError(`Invalid transaction id: ${transactionId}`);
      }

      return hexString;
    }

    default: {
      throw externalError("Vm type not implemented");
    }
  }
};
