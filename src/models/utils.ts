import { VmType } from "@reservoir0x/relay-protocol-sdk";

import { externalError, internalError } from "../common/error";

export type DbEntry<T> = T & {
  createdAt: Date;
  updatedAt: Date;
};

// Normalize and validate bytes
export const nvBytes = (bytes: string, requiredLengthInBytes: number) => {
  if (requiredLengthInBytes % 2 !== 0) {
    throw internalError("The required length must be an even number");
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

    default: {
      throw externalError("Vm type not implemented");
    }
  }
};
