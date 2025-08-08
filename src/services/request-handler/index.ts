import {
  encodeWithdrawal,
  getDecodedWithdrawalId,
} from "@reservoir0x/relay-protocol-sdk";
import { Keypair } from "@solana/web3.js";
import * as bitcoin from "bitcoinjs-lib";
import bs58 from "bs58";
import { randomBytes } from "crypto";
import { ECPairFactory } from "ecpair";
import * as ecc from "tiny-secp256k1";
import nacl from "tweetnacl";
import {
  Address,
  createWalletClient,
  encodeFunctionData,
  Hex,
  http,
  parseAbi,
  zeroAddress,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

import {
  ChainMetadataEthereumVm,
  getAllocatorForChain,
  getChain,
} from "../../common/chains";
import { db } from "../../common/db";
import { externalError } from "../../common/error";
import { config } from "../../config";
import {
  getBalanceLock,
  saveBalanceLock,
  unlockBalanceLock,
} from "../../models/balances";
import { saveWithdrawalRequest } from "../../models/withdrawal-requests";

type AdditionalDataBitcoinVm = {
  allocatorUtxos: { txid: string; vout: number; value: string }[];
  relayer: string;
  relayerUtxos: { txid: string; vout: number; value: string }[];
  transactionFee: string;
};

type WithdrawalRequest = {
  ownerChainId: string;
  owner: string;
  chainId: string;
  currency: string;
  amount: string;
  recipient: string;
  additionalData?: {
    "bitcoin-vm"?: AdditionalDataBitcoinVm;
  };
};

type UnlockRequest = {
  id: string;
};

export class RequestHandlerService {
  public async handleWithdrawal(request: WithdrawalRequest) {
    let id: string;
    let encodedData: string;
    let signature: string;
    let expiration: number | undefined;

    const chain = await getChain(request.chainId);
    switch (chain.vmType) {
      case "ethereum-vm": {
        expiration = Math.floor(Date.now() / 1000) + 5 * 60;

        const data = {
          calls:
            request.currency === zeroAddress
              ? [
                  {
                    to: request.recipient,
                    data: "0x",
                    value: request.amount,
                    allowFailure: false,
                  },
                ]
              : [
                  {
                    to: request.currency,
                    data: encodeFunctionData({
                      abi: parseAbi([
                        "function transfer(address to, uint256 amount)",
                      ]),
                      functionName: "transfer",
                      args: [
                        request.recipient as Address,
                        BigInt(request.amount),
                      ],
                    }),
                    value: "0",
                    allowFailure: false,
                  },
                ],
          nonce: BigInt("0x" + randomBytes(32).toString("hex")).toString(),
          expiration,
        };

        id = getDecodedWithdrawalId({
          vmType: chain.vmType,
          withdrawal: data,
        });

        encodedData = encodeWithdrawal({
          vmType: chain.vmType,
          withdrawal: data,
        });

        const eip712TypedData = {
          domain: {
            name: "RelayDepository",
            version: "1",
            chainId: (chain.metadata as ChainMetadataEthereumVm).chainId,
            verifyingContract: chain.depository as Address,
          },
          types: {
            CallRequest: [
              { name: "calls", type: "Call[]" },
              { name: "nonce", type: "uint256" },
              { name: "expiration", type: "uint256" },
            ],
            Call: [
              { name: "to", type: "address" },
              { name: "data", type: "bytes" },
              { name: "value", type: "uint256" },
              { name: "allowFailure", type: "bool" },
            ],
          },
          primaryType: "CallRequest",
          message: {
            calls: data.calls.map((c) => ({
              to: c.to as Address,
              data: c.data as Hex,
              value: BigInt(c.value),
              allowFailure: c.allowFailure,
            })),
            nonce: BigInt(data.nonce),
            expiration: BigInt(data.expiration),
          },
        } as const;

        const walletClient = createWalletClient({
          account: privateKeyToAccount(config.ecdsaPrivateKey as Hex),
          // Viem will error if we pass no URL to the `http` transport, so here we
          // just pass a mock URL, which isn't even going to be used since we only
          // use `walletClient` for signing messages offchain
          transport: http("http://localhost:1"),
        });

        signature = await walletClient.signTypedData(eip712TypedData);

        break;
      }

      case "solana-vm": {
        expiration = Math.floor(Date.now() / 1000) + 5 * 60;

        const data = {
          recipient: request.recipient,
          token: request.currency,
          amount: request.amount,
          nonce: BigInt("0x" + randomBytes(8).toString("hex")).toString(),
          expiration,
        };

        id = getDecodedWithdrawalId({
          vmType: chain.vmType,
          withdrawal: data,
        });

        encodedData = encodeWithdrawal({
          vmType: chain.vmType,
          withdrawal: data,
        });

        signature =
          "0x" +
          Buffer.from(
            nacl.sign.detached(
              Buffer.from(id.slice(2), "hex"),
              Keypair.fromSecretKey(bs58.decode(config.ed25519PrivateKey))
                .secretKey
            )
          ).toString("hex");

        break;
      }

      case "bitcoin-vm": {
        const additionalData = request.additionalData?.["bitcoin-vm"];
        if (!additionalData) {
          throw externalError(
            "Additional data is required for generating the withdrawal request"
          );
        }

        // Dust threshold in satoshis
        const MIN_UTXO_VALUE = 546n;

        // Compute the allocator change
        const totalAllocatorUtxosValue = additionalData.allocatorUtxos.reduce(
          (acc, { value }) => acc + BigInt(value),
          0n
        );
        const allocatorChange =
          totalAllocatorUtxosValue - BigInt(request.amount);
        if (allocatorChange < MIN_UTXO_VALUE) {
          throw externalError("Insufficient allocator UTXOs");
        }

        // Compute the relayer change
        const totalRelayerUtxosValue = additionalData.relayerUtxos.reduce(
          (acc, { value }) => acc + BigInt(value),
          0n
        );
        const relayerChange =
          totalRelayerUtxosValue - BigInt(additionalData.transactionFee);
        if (relayerChange < 0) {
          throw externalError("Insufficient relayer UTXOs");
        }

        // Start constructing the PSBT
        const psbt = new bitcoin.Psbt({ network: bitcoin.networks.bitcoin });

        const allocator = await getAllocatorForChain(request.chainId);

        // Add allocator input UTXOs
        for (const utxo of additionalData.allocatorUtxos) {
          psbt.addInput({
            hash: utxo.txid,
            index: utxo.vout,
            // For enabling Replace-By-Fee
            sequence: 0xfffffffd,
            witnessUtxo: {
              script: bitcoin.address.toOutputScript(
                allocator,
                bitcoin.networks.bitcoin
              ),
              value: Number(BigInt(utxo.value)),
            },
          });
        }

        // Add relayer input UTXOs
        for (const utxo of additionalData.relayerUtxos) {
          if (additionalData.relayer === allocator) {
            throw externalError(
              "The relayer must be different from the allocator"
            );
          }

          psbt.addInput({
            hash: utxo.txid,
            index: utxo.vout,
            // For enabling Replace-By-Fee
            sequence: 0xfffffffd,
            witnessUtxo: {
              script: bitcoin.address.toOutputScript(
                additionalData.relayer,
                bitcoin.networks.bitcoin
              ),
              value: Number(BigInt(utxo.value)),
            },
          });
        }

        // Add allocator change
        psbt.addOutput({
          address: allocator,
          value: Number(allocatorChange),
        });

        // Add relayer change
        if (relayerChange >= MIN_UTXO_VALUE) {
          psbt.addOutput({
            address: additionalData.relayer,
            value: Number(relayerChange),
          });
        }

        // Sign the PSBT using the allocator wallet
        const keyPair = ECPairFactory(ecc).fromPrivateKey(
          Buffer.from(config.ecdsaPrivateKey, "hex")
        );
        await psbt.signAllInputsAsync({
          publicKey: Buffer.from(keyPair.publicKey),
          sign: (hash: Buffer) => {
            return Buffer.from(keyPair.sign(hash));
          },
        });

        id = getDecodedWithdrawalId({
          vmType: chain.vmType,
          withdrawal: {
            psbt: psbt.toHex(),
          },
        });

        encodedData = encodeWithdrawal({
          vmType: chain.vmType,
          withdrawal: {
            psbt: psbt.toHex(),
          },
        });

        // The signature is bundled within the the encoded withdrawal data
        signature = "0x";

        break;
      }

      default: {
        throw externalError("Vm type not implemented");
      }
    }

    await db.tx(async (tx) => {
      const newBalance = await saveBalanceLock(
        {
          id,
          source: "withdrawal",
          ownerChainId: request.ownerChainId,
          owner: request.owner,
          currencyChainId: request.chainId,
          currency: request.currency,
          amount: request.amount,
          expiration,
        },
        { tx }
      );
      if (!newBalance) {
        throw externalError("Failed to save balance lock");
      }

      const withdrawalRequest = await saveWithdrawalRequest(
        {
          id,
          ownerChainId: request.ownerChainId,
          owner: request.owner,
          chainId: request.chainId,
          currency: request.currency,
          amount: request.amount,
          recipient: request.recipient,
          encodedData,
          signature,
        },
        { tx }
      );
      if (!withdrawalRequest) {
        throw externalError("Failed to save withdrawal request");
      }
    });

    return {
      id,
      encodedData,
      signature,
      signer: await getAllocatorForChain(request.chainId),
    };
  }

  public async handleUnlock(request: UnlockRequest) {
    const balanceLock = await getBalanceLock(request.id);
    if (!balanceLock) {
      throw externalError("Balance lock does not exist");
    }
    if (balanceLock.source !== "deposit") {
      throw externalError(
        "Only 'deposit' balance locks can be unlocked via this flow"
      );
    }

    const newBalance = await unlockBalanceLock(request.id);
    if (!newBalance) {
      throw externalError("Failed to unlock balance");
    }
  }
}
