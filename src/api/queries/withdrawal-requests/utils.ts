import {
  decodeWithdrawal,
  encodeWithdrawal,
} from "@relay-protocol/settlement-sdk";
import * as bitcoin from "bitcoinjs-lib";
import { decodeAbiParameters, Hex } from "viem";

import { getChain } from "../../../common/chains";
import { externalError } from "../../../common/error";
import { getBitcoinSignerPubkey } from "../../../utils/onchain-allocator";

const stripHexPrefix = (value: string) =>
  value.startsWith("0x") ? value.slice(2) : value;

const normalizeBitcoinPartialSignature = (
  signatureHex: string,
  sighashType: number,
): Buffer => {
  const signature = Buffer.from(stripHexPrefix(signatureHex), "hex");

  try {
    bitcoin.script.signature.decode(signature);
    return signature;
  } catch {
    // Continue to compact signature handling
  }

  if (signature.length === 64) {
    return Buffer.from(bitcoin.script.signature.encode(signature, sighashType));
  }

  if (signature.length === 65) {
    const hasRecoveryId = (value: number) => [0, 1, 27, 28].includes(value);
    const compactSignature =
      hasRecoveryId(signature[0]) && !hasRecoveryId(signature[64])
        ? signature.subarray(1, 65)
        : signature.subarray(0, 64);

    return Buffer.from(
      bitcoin.script.signature.encode(compactSignature, sighashType),
    );
  }

  throw externalError(
    `Invalid bitcoin signature format: expected DER+sighash, 64-byte compact, or 65-byte compact+recoveryId, got ${signature.length} bytes`,
  );
};

const enhanceBitcoinWithdrawalEncodedData = async (
  chainId: string,
  encodedData: string,
  signature?: string,
) => {
  if (!signature || signature === "0x") {
    return encodedData;
  }

  const decoded = decodeWithdrawal(encodedData, "bitcoin-vm") as {
    vmType: "bitcoin-vm";
    withdrawal: { psbt: string };
  };
  const psbt = bitcoin.Psbt.fromHex(stripHexPrefix(decoded.withdrawal.psbt));

  const signatures = decodeAbiParameters(
    [{ type: "bytes[]" }],
    signature as Hex,
  )[0];
  if (signatures.length !== psbt.txInputs.length) {
    throw externalError(
      `Invalid bitcoin signature count: expected ${psbt.txInputs.length}, got ${signatures.length}`,
    );
  }

  const signerPublicKey = await getBitcoinSignerPubkey(chainId);
  for (let i = 0; i < signatures.length; i++) {
    const partialSig = psbt.data.inputs[i].partialSig ?? [];
    const normalizedSignature = normalizeBitcoinPartialSignature(
      signatures[i],
      bitcoin.Transaction.SIGHASH_ALL,
    );

    psbt.updateInput(i, {
      partialSig: [
        ...partialSig,
        {
          pubkey: signerPublicKey,
          signature: normalizedSignature,
        },
      ],
    });
  }

  return encodeWithdrawal({
    vmType: "bitcoin-vm",
    withdrawal: { psbt: psbt.toHex() },
  });
};

export const enhanceEncodedData = async (
  chainId: string,
  encodedData: string,
  signature?: string,
) => {
  const { vmType } = await getChain(chainId);

  switch (vmType) {
    case "bitcoin-vm":
      return enhanceBitcoinWithdrawalEncodedData(
        chainId,
        encodedData,
        signature,
      );

    default:
      return encodedData;
  }
};
