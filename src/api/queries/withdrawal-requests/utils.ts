import { encodeWithdrawal } from "@relay-protocol/settlement-sdk";
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

  const signatures = decodeAbiParameters(
    [{ type: "bytes[]" }],
    signature as Hex,
  )[0];

  const transactionData = decodeAbiParameters(
    [
      {
        type: "tuple",
        components: [
          {
            type: "tuple[]",
            name: "inputs",
            components: [
              { type: "bytes", name: "txid" },
              { type: "bytes", name: "index" },
              { type: "bytes", name: "script" },
              { type: "bytes", name: "value" },
            ],
          },
          {
            type: "tuple[]",
            name: "outputs",
            components: [
              { type: "bytes", name: "value" },
              { type: "bytes", name: "script" },
            ],
          },
        ],
      },
    ],
    encodedData as Hex,
  )[0] as {
    inputs: { txid: Hex; index: Hex; script: Hex; value: Hex }[];
    outputs: { value: Hex; script: Hex }[];
  };

  const fromLittleEndian = (value: Hex): bigint => {
    const bytes = Buffer.from(value.slice(2), "hex");
    const reversed = Buffer.from(bytes).reverse();
    const normalized = reversed.toString("hex").replace(/^0+/, "") || "0";
    return BigInt(`0x${normalized}`);
  };

  const psbt = new bitcoin.Psbt({ network: bitcoin.networks.bitcoin });
  psbt.setVersion(1);

  const signerPublicKey = await getBitcoinSignerPubkey(chainId);
  for (const input of transactionData.inputs) {
    const txid = Buffer.from(input.txid.slice(2), "hex")
      .reverse()
      .toString("hex");

    psbt.addInput({
      hash: txid,
      index: Number(fromLittleEndian(input.index)),
      sequence: 0xfffffffd,
      sighashType: bitcoin.Transaction.SIGHASH_ALL,
      witnessUtxo: {
        script: Buffer.from(input.script.slice(2), "hex"),
        value: Number(fromLittleEndian(input.value)),
      },
      // The allocator pubkey is included so signers can identify inputs by key
      bip32Derivation: [
        {
          masterFingerprint: Buffer.alloc(4),
          path: "m",
          pubkey: signerPublicKey,
        },
      ],
    });
  }

  for (const output of transactionData.outputs) {
    psbt.addOutput({
      script: Buffer.from(output.script.slice(2), "hex"),
      value: Number(fromLittleEndian(output.value)),
    });
  }

  if (signatures.length !== transactionData.inputs.length) {
    throw externalError(
      `Invalid bitcoin signature count: expected ${transactionData.inputs.length}, got ${signatures.length}`,
    );
  }

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
      return enhanceBitcoinWithdrawalEncodedData(chainId, encodedData, signature);

    default:
      return encodedData;
  }
};
