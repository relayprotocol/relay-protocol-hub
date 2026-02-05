import {
  decodeWithdrawal,
  encodeWithdrawal,
  getDecodedWithdrawalId,
  getVmTypeNativeCurrency,
} from "@relay-protocol/settlement-sdk";
import { PublicKey, Keypair, SystemProgram } from "@solana/web3.js";
import * as bitcoin from "bitcoinjs-lib";
import bs58 from "bs58";
import { randomBytes } from "crypto";
import { ECPairFactory } from "ecpair";
import * as ecc from "tiny-secp256k1";
import TronWeb from "tronweb";
import nacl from "tweetnacl";
import {
  Address,
  createWalletClient,
  decodeAbiParameters,
  encodeFunctionData,
  Hex,
  http,
  parseAbi,
  zeroAddress,
  encodeAbiParameters,
  zeroHash,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

import {
  ChainMetadataEthereumVm,
  ChainMetadataTronVm,
  getOffchainAllocatorForChain,
  getOnchainAllocatorForChain,
  getChain,
  Chain,
  getChains,
} from "../../common/chains";
import { db } from "../../common/db";
import { externalError } from "../../common/error";
import { logger } from "../../common/logger";
import {
  getBitcoinSignerPubkey,
  getOnchainAllocator,
  getSignature,
  getSignatureFromContract,
  handleOneTimeApproval,
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
  // Used by offchain allocator
  relayer?: string;
  relayerUtxos?: { txid: string; vout: number; value: string }[];
  transactionFee?: string;
  // Used by onchain allocator
  feeRate?: number;
};

type AdditionalDataHyperliquidVm = {
  currencyHyperliquidSymbol: string;
  currentTime?: number;
};

type AllocatorSubmitRequestParams = {
  chainId: string;
  currency: string;
  amount: string;
  recipient: string;
  spender: string;
  nonce: string;
  additionalData?: {
    "bitcoin-vm"?: AdditionalDataBitcoinVm;
    "hyperliquid-vm"?: AdditionalDataHyperliquidVm;
  };
};

type OnchainWithdrawalRequest = {
  data: AllocatorSubmitRequestParams;
  result: {
    id: string;
    encodedData: string;
    signature?: string;
    payloadId?: string;
    submitWithdrawalRequestParams?: PayloadParams;
    signer: string;
  };
};

type OnChainWithdrawalSignatureRequest = {
  data: {
    payloadId: string;
    payloadParams: AllocatorSubmitRequestParams;
  };
  result: {
    encodedData: string;
    signer: string;
    signature?: string;
  };
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
    "hyperliquid-vm"?: AdditionalDataHyperliquidVm;
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
          ({ id, encodedData, payloadId, payloadParams } =
            await this._submitWithdrawRequest(chain, request));
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
          ({ id, encodedData, payloadId, payloadParams } =
            await this._submitWithdrawRequest(chain, request));

          break;
        } else {
          const expiration = Math.floor(Date.now() / 1000) + 5 * 60;

          const data = {
            recipient: request.recipient,
            token: request.currency,
            amount: request.amount,
            nonce: BigInt("0x" + randomBytes(8).toString("hex")).toString(),
            expiration,
            // TODO: Use correct values fetched from the depository
            domain: zeroHash,
            vaultAddress: SystemProgram.programId.toBase58(),
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
                  .secretKey,
              ),
            ).toString("hex");

          break;
        }
      }

      case "bitcoin-vm": {
        if (request.mode === "onchain") {
          const additionalData = request.additionalData?.["bitcoin-vm"];
          if (!additionalData) {
            throw externalError(
              "Additional data is required for generating the withdrawal request",
            );
          }

          ({ id, encodedData, payloadId, payloadParams } =
            await this._submitWithdrawRequest(chain, request));

          break;
        } else {
          const additionalData = request.additionalData?.["bitcoin-vm"];
          if (!additionalData) {
            throw externalError(
              "Additional data is required for generating the withdrawal request",
            );
          }

          // Dust threshold in satoshis
          const MIN_UTXO_VALUE = 546n;

          // Compute the allocator change
          const totalAllocatorUtxosValue = additionalData.allocatorUtxos.reduce(
            (acc, { value }) => acc + BigInt(value),
            0n,
          );
          const allocatorChange =
            totalAllocatorUtxosValue - BigInt(request.amount);
          if (
            allocatorChange < 0n ||
            (allocatorChange > 0n && allocatorChange < MIN_UTXO_VALUE)
          ) {
            throw externalError("Insufficient allocator UTXOs");
          }

          // Compute the relayer change
          const totalRelayerUtxosValue = additionalData.relayerUtxos!.reduce(
            (acc, { value }) => acc + BigInt(value),
            0n,
          );
          const relayerChange =
            BigInt(request.amount) +
            totalRelayerUtxosValue -
            BigInt(additionalData.transactionFee!);
          if (relayerChange < 0n) {
            throw externalError("Insufficient relayer UTXOs");
          }

          // Start constructing the PSBT
          const psbt = new bitcoin.Psbt({ network: bitcoin.networks.bitcoin });

          const allocator = await getOffchainAllocatorForChain(request.chainId);

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
                  bitcoin.networks.bitcoin,
                ),
                value: Number(BigInt(utxo.value)),
              },
            });
          }

          // Add relayer input UTXOs
          for (const utxo of additionalData.relayerUtxos!) {
            if (additionalData.relayer === allocator) {
              throw externalError(
                "The relayer must be different from the allocator",
              );
            }

            psbt.addInput({
              hash: utxo.txid,
              index: utxo.vout,
              // For enabling Replace-By-Fee
              sequence: 0xfffffffd,
              witnessUtxo: {
                script: bitcoin.address.toOutputScript(
                  additionalData.relayer!,
                  bitcoin.networks.bitcoin,
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
              address: additionalData.relayer!,
              value: Number(relayerChange),
            });
          }

          // Sign the PSBT using the allocator wallet
          const ecdsaPk = config.ecdsaPrivateKey;
          const keyPair = ECPairFactory(ecc).fromPrivateKey(
            Buffer.from(
              ecdsaPk.startsWith("0x") ? ecdsaPk.slice(2) : ecdsaPk,
              "hex",
            ),
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

      case "hyperliquid-vm": {
        if (request.mode === "onchain") {
          const additionalData = request.additionalData?.["hyperliquid-vm"];
          if (!additionalData) {
            throw externalError(
              "Additional data is required for generating the withdrawal request",
            );
          }

          ({ id, encodedData, payloadId, payloadParams } =
            await this._submitWithdrawRequest(chain, request));

          break;
        } else {
          throw externalError("Offchain allocator mode not implemented");
        }
      }

      case "tron-vm": {
        if (request.mode === "onchain") {
          ({ id, encodedData, payloadId, payloadParams } =
            await this._submitWithdrawRequest(chain, request));

          break;
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
                            "0x",
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
            privateKey,
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
          { tx },
        );
        if (!newBalance) {
          throw externalError("Failed to save balance lock");
        }

        logger.info(
          "tracking",
          JSON.stringify({
            msg: "Executing `withdrawal` request",
            request,
            newBalance: newBalance ?? null,
          }),
        );
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
        { tx },
      );
      if (!withdrawalRequest) {
        throw externalError("Failed to save withdrawal request");
      }

      logger.info(
        "tracking",
        JSON.stringify({
          msg: "Executing `withdrawal` request",
          request,
          withdrawalRequest: withdrawalRequest ?? null,
        }),
      );
    });

    return {
      id,
      encodedData,
      submitWithdrawalRequestParams: payloadParams,
      signature,
      signer:
        request.mode === "onchain"
          ? await getOnchainAllocatorForChain(request.chainId)
          : await getOffchainAllocatorForChain(request.chainId),
    };
  }

  public async handleOnChainWithdrawal(
    request: OnchainWithdrawalRequest["data"],
  ): Promise<OnchainWithdrawalRequest["result"]> {
    let id: string;
    let encodedData: string;
    let signature: string | undefined;
    let payloadId: string | undefined;
    let payloadParams: PayloadParams | undefined;

    const chain = await getChain(request.chainId);
    switch (chain.vmType) {
      case "ethereum-vm": {
        ({ id, encodedData, payloadId, payloadParams } =
          await this._submitWithdrawRequest(chain, request));
        break;
      }

      case "solana-vm": {
        ({ id, encodedData, payloadId, payloadParams } =
          await this._submitWithdrawRequest(chain, request));
        break;
      }

      case "bitcoin-vm": {
        throw externalError("Onchain allocator mode not implemented");
      }

      case "hyperliquid-vm": {
        const isNativeCurrency =
          request.currency === getVmTypeNativeCurrency(chain.vmType);
        if (!isNativeCurrency) {
          const additionalData = request.additionalData?.["hyperliquid-vm"];
          if (!additionalData) {
            throw externalError(
              "Additional data is required for generating the withdrawal request",
            );
          }
        }

        ({ id, encodedData, payloadId, payloadParams } =
          await this._submitWithdrawRequest(chain, request));
        break;
      }

      case "tron-vm": {
        ({ id, encodedData, payloadId, payloadParams } =
          await this._submitWithdrawRequest(chain, request));
        break;
      }

      default: {
        throw externalError("Vm type not implemented");
      }
    }

    return {
      id,
      encodedData,
      signature,
      payloadId,
      submitWithdrawalRequestParams: payloadParams,
      signer: await getOnchainAllocatorForChain(request.chainId),
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

    // Will throw if the withdrawal is not ready
    this._withdrawalIsReady(withdrawalRequest.payloadId);

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

      logger.info(
        "tracking",
        JSON.stringify({
          msg: "Executing `withdrawal-signature` request",
          request,
          newBalance: newBalance ?? null,
        }),
      );
    }

    // Only trigger the signing process if we don't already have a valid signature
    const signature = await getSignature(withdrawalRequest.id);
    if (!signature) {
      this._signPayload(withdrawalRequest.payloadParams);
    }
  }

  public async handleOnChainWithdrawalSignature(
    request: OnChainWithdrawalSignatureRequest["data"],
  ): Promise<OnChainWithdrawalSignatureRequest["result"]> {
    // Will throw if the withdrawal is not ready
    this._withdrawalIsReady(request.payloadId);

    // Get data from the contract
    const { contract } = await getOnchainAllocator();
    const encodedData = await contract.read.payloads([
      request.payloadId as Hex,
    ]);

    // Get signer address from near MPC
    const signer = await getOnchainAllocatorForChain(
      request.payloadParams.chainId,
    );
    // Check if the signature already exists
    const signature = await getSignatureFromContract(
      request.payloadParams.chainId,
      request.payloadId,
      encodedData,
    );

    // If not, then get one
    if (!signature) {
      const chain = await getChain(request.payloadParams.chainId);
      const payloadParams = this.parseAllocatorPayloadParams(
        chain.vmType,
        chain.depository!,
        chain.metadata.allocatorChainId!,
        request.payloadParams.currency,
        request.payloadParams.amount,
        request.payloadParams.recipient,
        request.payloadParams.spender,
        request.payloadParams.nonce,
        request.payloadParams.additionalData,
      );

      this._signPayload(payloadParams);
      return {
        encodedData,
        signer,
      };
    }

    return {
      encodedData,
      signature,
      signer,
    };
  }

  public async handleUnlock(request: UnlockRequest) {
    const balanceLock = await getBalanceLock(request.id);
    if (!balanceLock) {
      throw externalError("Balance lock does not exist");
    }
    if (balanceLock.source !== "deposit") {
      throw externalError(
        "Only 'deposit' balance locks can be unlocked via this flow",
      );
    }

    const newBalance = await unlockBalanceLock(request.id, {
      checkExpiration: true,
    });
    if (!newBalance) {
      throw externalError("Failed to unlock balance");
    }

    logger.info(
      "tracking",
      JSON.stringify({
        msg: "Executing `unlock` request",
        request,
        newBalance: newBalance ?? null,
      }),
    );
  }

  public parseAllocatorPayloadParams(
    vmType: string,
    depository: string,
    allocatorChainId: string,
    currency: string,
    amount: string,
    recipient: string,
    spender: string,
    nonce: string,
    additionalData?: {
      "bitcoin-vm"?: AdditionalDataBitcoinVm;
      "hyperliquid-vm"?: AdditionalDataHyperliquidVm;
    },
  ): PayloadParams {
    const defaultParams = {
      chainId: allocatorChainId!,
      depository: depository,
      currency: currency.toLowerCase(),
      spender: spender.toLowerCase(),
      receiver: recipient.toLowerCase(),
      amount: amount,
      data: "0x",
      nonce,
    };

    switch (vmType) {
      case "ethereum-vm": {
        return defaultParams;
      }

      case "bitcoin-vm": {
        const bitcoinAdditionalData = additionalData?.["bitcoin-vm"];
        if (!bitcoinAdditionalData) {
          throw externalError("Additional data is required for bitcoin-vm");
        }

        const allocatorScriptPubKey = `0x${bitcoin.address
          .toOutputScript(depository, bitcoin.networks.bitcoin)
          .toString("hex")}` as Hex;

        const toLittleEndianTxid = (txid: string): Hex => {
          const normalizedTxid = txid.startsWith("0x") ? txid.slice(2) : txid;
          if (!/^[0-9a-fA-F]{64}$/.test(normalizedTxid)) {
            throw externalError("Invalid bitcoin UTXO txid");
          }

          return `0x${Buffer.from(normalizedTxid, "hex")
            .reverse()
            .toString("hex")}` as Hex;
        };

        const data = encodeAbiParameters(
          [
            {
              type: "tuple",
              components: [
                {
                  type: "tuple[]",
                  name: "utxos",
                  components: [
                    { type: "bytes32", name: "txid" },
                    { type: "uint32", name: "index" },
                    { type: "uint64", name: "value" },
                    { type: "bytes", name: "scriptPubKey" },
                  ],
                },
                { type: "uint64", name: "feeRate" },
              ],
            },
          ],
          [
            {
              utxos: bitcoinAdditionalData.allocatorUtxos.map((utxo) => ({
                txid: toLittleEndianTxid(utxo.txid),
                index: utxo.vout,
                value: BigInt(utxo.value),
                scriptPubKey: allocatorScriptPubKey,
              })),
              feeRate: BigInt(bitcoinAdditionalData.feeRate!),
            },
          ],
        );

        return {
          ...defaultParams,
          receiver: bitcoin.address
            .toOutputScript(recipient, bitcoin.networks.bitcoin)
            .toString("base64"),
          data,
        };
      }

      case "tron-vm": {
        // The "tron-vm" payload builder (which is the "ethereum-vm" one) expects addresses to be hex-encoded
        const toHex = (address: string) =>
          TronWeb.utils.address
            .toHex(address)
            .replace(TronWeb.utils.address.ADDRESS_PREFIX_REGEX, "0x");
        return {
          ...defaultParams,
          depository: toHex(depository),
          currency: toHex(currency),
          receiver: toHex(recipient),
        };
      }

      case "solana-vm": {
        // The "solana-vm" payload builder expects addresses to be hex-encoded
        const toHexString = (address: string) =>
          new PublicKey(address).toBuffer().toString("hex");
        return {
          ...defaultParams,
          currency:
            currency === getVmTypeNativeCurrency(vmType)
              ? ""
              : toHexString(currency),
          receiver: toHexString(recipient),
        };
      }

      case "hyperliquid-vm": {
        const isNativeCurrency = currency === getVmTypeNativeCurrency(vmType);

        // TODO: We probably shouldn't be letting the user choose the time in order
        // to preserve the assumption that the time is always incrementing. However
        // at the moment we need these for deterministic payload ids.
        const currentTime = BigInt(
          additionalData!["hyperliquid-vm"]!.currentTime ?? Date.now(),
        );
        const currencyDex =
          currency.slice(34) === ""
            ? "spot"
            : Buffer.from(currency.slice(34), "hex").toString("ascii");
        const data = isNativeCurrency
          ? encodeAbiParameters([{ type: "uint64" }], [currentTime])
          : encodeAbiParameters(
              [{ type: "uint64" }, { type: "string" }, { type: "string" }],
              [currentTime, currencyDex, currencyDex],
            );

        return {
          ...defaultParams,
          currency: isNativeCurrency
            ? ""
            : `${
                additionalData!["hyperliquid-vm"]!.currencyHyperliquidSymbol
              }:${currency.toLowerCase()}`,
          data,
        };
      }

      default: {
        throw externalError("Vm type not implemented for payload params");
      }
    }
  }

  private async _submitWithdrawRequest(
    chain: Chain,
    request: {
      chainId: string;
      currency: string;
      amount: string;
      recipient: string;
      spender?: string;
      nonce?: string;
      additionalData?: {
        "bitcoin-vm"?: AdditionalDataBitcoinVm;
        "hyperliquid-vm"?: AdditionalDataHyperliquidVm;
      };
    },
  ): Promise<{
    id: string;
    encodedData: string;
    payloadId: string;
    payloadParams: PayloadParams;
  }> {
    const { contract, publicClient, walletClient } =
      await getOnchainAllocator();

    if (!request.spender) {
      request.spender = walletClient.account.address.toLowerCase();
    }
    if (!request.nonce) {
      request.nonce = `0x${randomBytes(32).toString("hex")}`;
    }

    const payloadParams = this.parseAllocatorPayloadParams(
      chain.vmType,
      chain.depository!,
      chain.metadata.allocatorChainId!,
      request.currency,
      request.amount,
      request.recipient,
      request.spender,
      request.nonce,
      request.additionalData,
    );

    // This is needed before being able to submit withdraw requests
    await handleOneTimeApproval();

    const txHash = await contract.write.submitWithdrawRequest([
      payloadParams as any,
    ]);
    const payloadId = await publicClient
      .waitForTransactionReceipt({ hash: txHash })
      .then(
        (receipt) =>
          receipt.logs.find(
            (l) =>
              l.address.toLowerCase() === contract.address.toLowerCase() &&
              // We need the "PayloadBuild" event
              l.topics[0] ===
                "0x007d52d35e656ce646ba5807d55724e47d53e72435a328e89eb6ce56b0e95d6a",
          )?.topics[1],
      );
    if (!payloadId) {
      throw externalError(
        "Withdrawal request submission failed to generate payload",
      );
    }

    const rawEncodedData = await contract.read.payloads([payloadId as Hex]);
    const encodedData =
      chain.vmType === "bitcoin-vm"
        ? await this._convertBitcoinTransactionDataToPsbtWithdrawal(
            request.chainId,
            rawEncodedData as Hex,
          )
        : rawEncodedData;

    const id = getDecodedWithdrawalId(
      decodeWithdrawal(encodedData, chain.vmType),
    );

    return {
      id,
      encodedData,
      payloadId,
      payloadParams,
    };
  }

  private async _convertBitcoinTransactionDataToPsbtWithdrawal(
    chainId: string,
    encodedData: Hex,
  ): Promise<string> {
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
      encodedData,
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

    const signerPubkey = await getBitcoinSignerPubkey(chainId);
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
            pubkey: signerPubkey,
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

    return encodeWithdrawal({
      vmType: "bitcoin-vm",
      withdrawal: { psbt: psbt.toHex() },
    });
  }

  private async _withdrawalIsReady(payloadId: string) {
    const { contract, publicClient } = await getOnchainAllocator();

    const payloadTimestamp = await contract.read.payloadTimestamps([
      payloadId as Hex,
    ]);
    const allocatorTimestamp = await publicClient
      .getBlock()
      .then((b) => b.timestamp);
    if (payloadTimestamp > allocatorTimestamp) {
      throw externalError("Withdrawal not ready to be signed");
    }
  }

  private async _signPayload(payloadParams: PayloadParams) {
    const { contract } = await getOnchainAllocator();

    // These are both the default recommended values
    const gasSettings = {
      signGas: 30_000_000_000_000n,
      callbackGas: 20_000_000_000_000n,
    };

    const chain = await getChains().then(
      (chains) =>
        Object.values(chains).find(
          (c) => c.metadata.allocatorChainId === payloadParams.chainId,
        )!,
    );
    if (chain.vmType === "bitcoin-vm") {
      const decodedData = decodeAbiParameters(
        [
          {
            type: "tuple",
            components: [
              {
                type: "tuple[]",
                name: "utxos",
                components: [
                  { type: "bytes32", name: "txid" },
                  { type: "uint32", name: "index" },
                  { type: "uint64", name: "value" },
                  { type: "bytes", name: "scriptPubKey" },
                ],
              },
              { type: "uint64", name: "feeRate" },
            ],
          },
        ],
        payloadParams.data as Hex,
      )[0] as {
        utxos: {
          txid: Hex;
          index: number;
          value: bigint;
          scriptPubKey: Hex;
        }[];
        feeRate: bigint;
      };

      await Promise.all(
        decodedData.utxos.map((_, i) =>
          contract.write.signWithdrawPayloadHash([
            payloadParams as any,
            "0x",
            gasSettings,
            i,
          ]),
        ),
      );
    } else {
      await contract.write.signWithdrawPayloadHash([
        payloadParams as any,
        "0x",
        gasSettings,
        0,
      ]);
    }
  }
}
