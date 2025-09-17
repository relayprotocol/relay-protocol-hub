import {
  decodeWithdrawal,
  encodeWithdrawal,
  getDecodedWithdrawalId,
  getVmTypeNativeCurrency,
} from "@reservoir0x/relay-protocol-sdk";
import { PublicKey, Keypair } from "@solana/web3.js";
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
import TronWeb from "tronweb";

import {
  ChainMetadataEthereumVm,
  ChainMetadataTronVm,
  getAllocatorForChain,
  getChain,
} from "../../common/chains";
import { db } from "../../common/db";
import { externalError } from "../../common/error";
import {
  getOnchainAllocator,
  getSignature,
  getSigner,
} from "../../utils/onchain-allocator";
import { config } from "../../config";
import {
  getBalanceLock,
  saveBalanceLock,
  unlockBalanceLock,
} from "../../models/balances";
import {
  getWithdrawalRequest,
  PayloadParams,
  saveWithdrawalRequest,
} from "../../models/withdrawal-requests";

type AdditionalDataBitcoinVm = {
  allocatorUtxos: { txid: string; vout: number; value: string }[];
  relayer: string;
  relayerUtxos: { txid: string; vout: number; value: string }[];
  transactionFee: string;
};

type WithdrawalRequest = {
  mode?: "offchain" | "onchain";
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

type WithdrawalSignatureRequest = {
  id: string;
};

type UnlockRequest = {
  id: string;
};

export class RequestHandlerService {
  public async handleWithdrawal(request: WithdrawalRequest) {
    let id: string;
    let encodedData: string;
    let signature: string | undefined;

    let payloadId: string | undefined;
    let payloadParams: PayloadParams | undefined;

    const chain = await getChain(request.chainId);
    switch (chain.vmType) {
      case "ethereum-vm": {
        if (request.mode === "onchain") {
          const { contract, publicClient, walletClient } =
            getOnchainAllocator();

          payloadParams = {
            chainId: Number(chain.metadata.allocatorChainId!),
            depository: chain.depository!.toLowerCase(),
            currency: request.currency.toLowerCase(),
            amount: request.amount,
            spender: walletClient.account.address.toLowerCase(),
            receiver: request.recipient.toLowerCase(),
            data: "0x",
            nonce: `0x${randomBytes(32).toString("hex")}`,
          };

          const txHash = await contract.write.submitWithdrawRequest([
            payloadParams as any,
          ]);
          payloadId = await publicClient
            .waitForTransactionReceipt({ hash: txHash })
            .then(
              (receipt) =>
                receipt.logs.find(
                  (l) =>
                    l.address.toLowerCase() ===
                      contract.address.toLowerCase() &&
                    // We need the "PayloadBuild" event
                    l.topics[0] ===
                      "0x007d52d35e656ce646ba5807d55724e47d53e72435a328e89eb6ce56b0e95d6a"
                )?.topics[1]
            );
          if (!payloadId) {
            throw externalError("Could not submit withdrawal request");
          }

          encodedData = await contract.read.payloads([payloadId as Hex]);

          id = getDecodedWithdrawalId(
            decodeWithdrawal(encodedData, chain.vmType)
          );

          break;
        } else {
          const expiration = Math.floor(Date.now() / 1000) + 5 * 60;

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
      }

      case "solana-vm": {
        if (request.mode === "onchain") {
          const { contract, publicClient, walletClient } =
            getOnchainAllocator();

          // The "solana-vm" payload builder expects addresses to be hex-encoded
          const toHexString = (address: string) =>
            new PublicKey(address).toBuffer().toString("hex");

          payloadParams = {
            chainId: Number(chain.metadata.allocatorChainId!),
            depository: chain.depository!,
            currency:
              request.currency === getVmTypeNativeCurrency(chain.vmType)
                ? ""
                : toHexString(request.currency),
            amount: request.amount,
            spender: walletClient.account.address.toLowerCase(),
            receiver: toHexString(request.recipient),
            data: "0x",
            nonce: `0x${randomBytes(32).toString("hex")}`,
          };

          const txHash = await contract.write.submitWithdrawRequest([
            payloadParams as any,
          ]);
          payloadId = await publicClient
            .waitForTransactionReceipt({ hash: txHash })
            .then(
              (receipt) =>
                receipt.logs.find(
                  (l) =>
                    l.address.toLowerCase() ===
                      contract.address.toLowerCase() &&
                    // We need the "PayloadBuild" event
                    l.topics[0] ===
                      "0x007d52d35e656ce646ba5807d55724e47d53e72435a328e89eb6ce56b0e95d6a"
                )?.topics[1]
            );
          if (!payloadId) {
            throw externalError("Could not submit withdrawal request");
          }

          encodedData = await contract.read.payloads([payloadId as Hex]);

          id = getDecodedWithdrawalId(
            decodeWithdrawal(encodedData, chain.vmType)
          );

          break;
        } else {
          const expiration = Math.floor(Date.now() / 1000) + 5 * 60;

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
      }

      case "bitcoin-vm": {
        if (request.mode === "onchain") {
          throw externalError("Onchain allocator mode not implemented");
        } else {
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
          if (allocatorChange > 0n && allocatorChange < MIN_UTXO_VALUE) {
            throw externalError("Insufficient allocator UTXOs");
          }

          // Compute the relayer change
          const totalRelayerUtxosValue = additionalData.relayerUtxos.reduce(
            (acc, { value }) => acc + BigInt(value),
            0n
          );
          const relayerChange =
            BigInt(request.amount) +
            totalRelayerUtxosValue -
            BigInt(additionalData.transactionFee);
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
          if (allocatorChange > 0n) {
            psbt.addOutput({
              address: allocator,
              value: Number(allocatorChange),
            });
          }

          // Add relayer change
          if (relayerChange >= MIN_UTXO_VALUE) {
            psbt.addOutput({
              address: additionalData.relayer,
              value: Number(relayerChange),
            });
          }

          // Sign the PSBT using the allocator wallet
          const ecdsaPk = config.ecdsaPrivateKey;
          const keyPair = ECPairFactory(ecc).fromPrivateKey(
            Buffer.from(
              ecdsaPk.startsWith("0x") ? ecdsaPk.slice(2) : ecdsaPk,
              "hex"
            )
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
      }

      case "tron-vm": {
        if (request.mode === "onchain") {
          throw externalError("Onchain allocator mode not implemented");
        } else {
          const expiration = Math.floor(Date.now() / 1000) + 5 * 60;

          const data = {
            calls:
              request.currency === getVmTypeNativeCurrency("tron-vm")
                ? [
                    {
                      to: TronWeb.utils.address.toHex(request.recipient),
                      data: "0x",
                      value: request.amount,
                      allowFailure: false,
                    },
                  ]
                : [
                    {
                      to: TronWeb.utils.address.toHex(request.currency),
                      data: new TronWeb.utils.ethersUtils.Interface([
                        "function transfer(address to, uint256 amount)",
                      ]).encodeFunctionData("transfer", [
                        TronWeb.utils.address
                          .toHex(request.recipient)
                          .replace(
                            TronWeb.utils.address.ADDRESS_PREFIX_REGEX,
                            "0x"
                          ),
                        request.amount,
                      ]),
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

          const domain = {
            name: "RelayDepository",
            version: "1",
            chainId: (chain.metadata as ChainMetadataTronVm).chainId,
            verifyingContract: TronWeb.utils.address.toHex(chain.depository!),
          };

          const types = {
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
          };

          const privateKey = config.ecdsaPrivateKey.startsWith("0x")
            ? config.ecdsaPrivateKey.slice(2)
            : config.ecdsaPrivateKey;

          signature = TronWeb.Trx._signTypedData(
            domain,
            types,
            data,
            privateKey
          );

          break;
        }
      }

      default: {
        throw externalError("Vm type not implemented");
      }
    }

    await db.tx(async (tx) => {
      // When using "onchain" mode, the balance lock will be done right before
      // triggering the signing process using the "withdrawals-signature" API.
      // This is to ensure atomicity with balance locking.
      if (request.mode !== "onchain") {
        const newBalance = await saveBalanceLock(
          {
            id,
            source: "withdrawal",
            ownerChainId: request.ownerChainId,
            owner: request.owner,
            currencyChainId: request.chainId,
            currency: request.currency,
            amount: request.amount,
          },
          { tx }
        );
        if (!newBalance) {
          throw externalError("Failed to save balance lock");
        }
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
          payloadId,
          payloadParams,
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
      signer:
        request.mode === "onchain"
          ? await getSigner(request.chainId)
          : await getAllocatorForChain(request.chainId),
    };
  }

  public async handleWithdrawalSignature(request: WithdrawalSignatureRequest) {
    const withdrawalRequest = await getWithdrawalRequest(request.id);
    if (!withdrawalRequest) {
      throw externalError("Could not find withdrawal request");
    }
    if (!withdrawalRequest.payloadId || !withdrawalRequest.payloadParams) {
      throw externalError("Withdrawal request not using 'onchain' mode");
    }

    const { contract, publicClient } = getOnchainAllocator();

    const payloadTimestamp = await contract.read.payloadTimestamps([
      withdrawalRequest.payloadId as Hex,
    ]);
    const allocatorTimestamp = await publicClient
      .getBlock()
      .then((b) => b.timestamp);
    if (payloadTimestamp > allocatorTimestamp) {
      throw externalError("Withdrawal not ready to be signed");
    }

    // Lock the balance (if we don't already have a lock on it)
    if (!(await getBalanceLock(withdrawalRequest.id))) {
      const newBalance = await saveBalanceLock({
        id: withdrawalRequest.id,
        source: "withdrawal",
        ownerChainId: withdrawalRequest.ownerChainId,
        owner: withdrawalRequest.owner,
        currencyChainId: withdrawalRequest.chainId,
        currency: withdrawalRequest.currency,
        amount: withdrawalRequest.amount,
      });
      if (!newBalance) {
        throw externalError("Failed to save balance lock");
      }
    }

    // Only trigger the signing process if we don't already have a valid signature
    const signature = await getSignature(withdrawalRequest.id);
    if (!signature) {
      await contract.write.signWithdrawPayload([
        withdrawalRequest.payloadParams as any,
        "0x",
        // These are both the default recommended values
        {
          signGas: 30_000_000_000_000n,
          callbackGas: 20_000_000_000_000n,
        },
      ]);
    }
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

    const newBalance = await unlockBalanceLock(request.id, {
      checkExpiration: true,
    });
    if (!newBalance) {
      throw externalError("Failed to unlock balance");
    }
  }
}
