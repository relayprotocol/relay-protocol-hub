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
import nacl from "tweetnacl";
import {
  Address,
  createWalletClient,
  encodeFunctionData,
  Hex,
  http,
  parseAbi,
  zeroAddress,
  encodeAbiParameters,
  zeroHash,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import TronWeb from "tronweb";

import {
  ChainMetadataEthereumVm,
  ChainMetadataTronVm,
  getOffchainAllocatorForChain,
  getOnchainAllocatorForChain,
  getChain,
  Chain,
} from "../../common/chains";
import { db } from "../../common/db";
import { externalError } from "../../common/error";
import { logger } from "../../common/logger";
import {
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
  relayer: string;
  relayerUtxos: { txid: string; vout: number; value: string }[];
  transactionFee: string;
};

type AdditionalDataHyperliquidVm = {
  currencyHyperliquidSymbol: string;
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

          ({ id, encodedData, signature } = await this._makeBitcoinSignature(
            chain,
            request.currency,
            request.amount,
            request.recipient,
            additionalData
          ));

          break;
        }
      }

      case "hyperliquid-vm": {
        if (request.mode === "onchain") {
          const additionalData = request.additionalData?.["hyperliquid-vm"];
          if (!additionalData) {
            throw externalError(
              "Additional data is required for generating the withdrawal request"
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
          throw externalError("Onchain allocator mode not implemented");
        } else {
          ({ id, encodedData, signature } = this._makeTronSignature(
            chain,
            request.currency,
            request.amount,
            request.recipient
          ));

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

        logger.info(
          "tracking",
          JSON.stringify({
            msg: "Executing `withdrawal` request",
            request,
            newBalance: newBalance ?? null,
          })
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
        { tx }
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
        })
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
    request: OnchainWithdrawalRequest["data"]
  ): Promise<OnchainWithdrawalRequest["result"]> {
    let id: string;
    let encodedData: string;

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
              "Additional data is required for generating the withdrawal request"
            );
          }
        }

        ({ id, encodedData, payloadId, payloadParams } =
          await this._submitWithdrawRequest(chain, request));

        break;
      }

      case "tron-vm": {
        // Use _makeTronSignature to generate id and encodedData
        ({ id, encodedData } = this._makeTronSignature(
          chain,
          request.currency,
          request.amount,
          request.recipient,
          request.nonce
        ));
        
        break;
      }

      default: {
        throw externalError("Vm type not implemented");
      }
    }

    return {
      id,
      encodedData,
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

    // will throw if withdrawal is not ready
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
        })
      );
    }

    // Only trigger the signing process if we don't already have a valid signature
    const signature = await getSignature(withdrawalRequest.id);
    if (!signature) {
      this._signPayload(withdrawalRequest.payloadParams);
    }
  }

  public async handleOnChainWithdrawalSignature(
    request: OnChainWithdrawalSignatureRequest["data"]
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
      request.payloadParams.chainId
    );

    // check if signature already exists
    const signature = await getSignatureFromContract(
      request.payloadParams.chainId,
      request.payloadId,
      encodedData
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
        request.payloadParams.additionalData
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
        "Only 'deposit' balance locks can be unlocked via this flow"
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
      })
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
    }
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

      // We dont have a payload builder for "tron-vm" 
      // but return params for consistency during the
      // onchain withdrawal flow
      case "tron-vm": {
        return defaultParams;
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

        const currencyDex =
          currency.slice(34) === ""
            ? "spot"
            : Buffer.from(currency.slice(34), "hex").toString("ascii");
        const data = isNativeCurrency
          ? encodeAbiParameters([{ type: "uint64" }], [BigInt(Date.now())])
          : encodeAbiParameters(
              [{ type: "uint64" }, { type: "string" }, { type: "string" }],
              [BigInt(Date.now()), currencyDex, currencyDex]
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
    }
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
      request.additionalData
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
                "0x007d52d35e656ce646ba5807d55724e47d53e72435a328e89eb6ce56b0e95d6a"
          )?.topics[1]
      );
    if (!payloadId) {
      throw externalError(
        "Withdrawal request submission failed to generate payload"
      );
    }

    const encodedData = await contract.read.payloads([payloadId as Hex]);

    const id = getDecodedWithdrawalId(
      decodeWithdrawal(encodedData, chain.vmType)
    );

    return {
      id,
      encodedData,
      payloadId,
      payloadParams,
    };
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

    // TODO: Once we integrate Bitcoin we might need to make multiple calls
    await contract.write.signWithdrawPayloadHash([
      payloadParams as any,
      "0x",
      // These are both the default recommended values
      {
        signGas: 30_000_000_000_000n,
        callbackGas: 20_000_000_000_000n,
      },
      0,
    ]);
  }

  private _makeTronSignature(
    chain: Chain,
    currency: string,
    amount: string,
    recipient: string,
    nonce?: string
  ): { id: string; encodedData: string; signature: string } {
    const expiration = Math.floor(Date.now() / 1000) + 5 * 60;

    const data = {
      calls:
        currency === getVmTypeNativeCurrency("tron-vm")
          ? [
              {
                to: TronWeb.utils.address.toHex(recipient),
                data: "0x",
                value: amount,
                allowFailure: false,
              },
            ]
          : [
              {
                to: TronWeb.utils.address.toHex(currency),
                data: new TronWeb.utils.ethersUtils.Interface([
                  "function transfer(address to, uint256 amount)",
                ]).encodeFunctionData("transfer", [
                  TronWeb.utils.address
                    .toHex(recipient)
                    .replace(
                      TronWeb.utils.address.ADDRESS_PREFIX_REGEX,
                      "0x"
                    ),
                  amount,
                ]),
                value: "0",
                allowFailure: false,
              },
            ],
      nonce: nonce ?? BigInt("0x" + randomBytes(32).toString("hex")).toString(),
      expiration,
    };

    const id = getDecodedWithdrawalId({
      vmType: "tron-vm",
      withdrawal: data,
    });

    const encodedData = encodeWithdrawal({
      vmType: "tron-vm",
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

    const signature = TronWeb.Trx._signTypedData(
      domain,
      types,
      data,
      privateKey
    );

    return { id, encodedData, signature };
  }

  private async _makeBitcoinSignature(
    chain: Chain,
    _currency: string,
    amount: string,
    _recipient: string,
    additionalData: AdditionalDataBitcoinVm
  ): Promise<{ id: string; encodedData: string; signature: string }> {
    // Dust threshold in satoshis
    const MIN_UTXO_VALUE = 546n;

    // Compute the allocator change
    const totalAllocatorUtxosValue = additionalData.allocatorUtxos.reduce(
      (acc, { value }) => acc + BigInt(value),
      0n
    );
    const allocatorChange =
      totalAllocatorUtxosValue - BigInt(amount);
    if (
      allocatorChange < 0n ||
      (allocatorChange > 0n && allocatorChange < MIN_UTXO_VALUE)
    ) {
      throw externalError("Insufficient allocator UTXOs");
    }

    // Compute the relayer change
    const totalRelayerUtxosValue = additionalData.relayerUtxos.reduce(
      (acc, { value }) => acc + BigInt(value),
      0n
    );
    const relayerChange =
      BigInt(amount) +
      totalRelayerUtxosValue -
      BigInt(additionalData.transactionFee);
    if (relayerChange < 0n) {
      throw externalError("Insufficient relayer UTXOs");
    }

    // Start constructing the PSBT
    const psbt = new bitcoin.Psbt({ network: bitcoin.networks.bitcoin });

    const allocator = await getOffchainAllocatorForChain(chain.id);

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

    const id = getDecodedWithdrawalId({
      vmType: "bitcoin-vm",
      withdrawal: {
        psbt: psbt.toHex(),
      },
    });

    const encodedData = encodeWithdrawal({
      vmType: "bitcoin-vm",
      withdrawal: {
        psbt: psbt.toHex(),
      },
    });

    // The signature is bundled within the encoded withdrawal data
    const signature = "0x";

    return { id, encodedData, signature };
  }
}
