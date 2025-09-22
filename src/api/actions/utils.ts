import { Address, Hex, verifyMessage } from "viem";

import { externalError } from "../../common/error";
import { config } from "../../config";

export const checkOracleSignatures = async (
  messageId: string,
  signatures: { oracle: string; signature: string }[]
) => {
  if (!signatures.length) {
    throw externalError(
      "At least one signature is required",
      "INSUFFICIENT_SIGNATURES"
    );
  }

  const _usedOracles: Record<string, boolean> = {};
  for (const { oracle, signature } of signatures) {
    if (_usedOracles[oracle.toLowerCase()]) {
      throw externalError("Duplicate oracle signature", "DUPLICATE_ORACLE");
    }
    _usedOracles[oracle.toLowerCase()] = true;

    if (config.allowedOracles && !config.allowedOracles.includes(oracle)) {
      throw externalError("Oracle not allowed", "UNAUTHORIZED_ORACLE");
    }

    const isSignatureValid = await verifyMessage({
      address: oracle as Address,
      message: {
        raw: messageId as Hex,
      },
      signature: signature as Hex,
    });
    if (!isSignatureValid) {
      throw externalError("Invalid signature", "INVALID_SIGNATURE");
    }
  }
};
