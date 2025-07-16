import {
  encodeWithdrawal,
  getDecodedWithdrawalId,
  bitcoin,
} from "@reservoir0x/relay-protocol-sdk";
import { Keypair } from "@solana/web3.js";
import bs58 from "bs58";
import { randomBytes } from "crypto";
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
  ChainMetadataBitcoinVm,
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
import { createAndSignTransaction } from "../../common/vm/bitcoin-vm/utils/transaction";

type WithdrawalRequest = {
  ownerChainId: string;
  owner: string;
  chainId: string;
  currency: string;
  amount: string;
  recipient: string;
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
        expiration = Math.floor(Date.now() / 1000) + 60 * 60;
        const data = {
          recipient: request.recipient,
          amount: request.amount,
          nonce: BigInt("0x" + randomBytes(8).toString("hex")).toString(),
          expiration,
          txId: "0x",
        };

        id = getDecodedWithdrawalId({
          vmType: chain.vmType,
          withdrawal: data,
        });

        // Get Bitcoin address from chain.depository
        if (!chain.depository) {
          throw externalError("Bitcoin depository address not configured for chain");
        }
        const bitcoinAddress = chain.depository;

        // Get UTXOs for the Bitcoin address
        const bitcoinRpc = bitcoin.createProvider((chain.metadata as ChainMetadataBitcoinVm).httpRpcUrl);
        const utxos = await bitcoinRpc.getUtxos(bitcoinAddress, true);
        
        if (utxos.length === 0) {
          throw externalError("No UTXOs available for Bitcoin withdrawal");
        }
        
        // Estimate fee rate (satoshis per byte)
        const feeRate = await bitcoinRpc.estimateSmartFee(2, "conservative");
        
        // Create and sign Bitcoin transaction
        const { txHex, txId } = await createAndSignTransaction(
          config.bitcoinPrivateKey,
          utxos,
          request.recipient,
          parseInt(request.amount),
          feeRate,
          !chain.id.includes("testnet") ? "bitcoin" : "testnet",
          {
            enableRBF: true,
          }
        );
        
        // Store txId in data field for Oracle to use
        data.txId = txId;
        
        // Re-encode withdrawal data with txId
        encodedData = encodeWithdrawal({
          vmType: chain.vmType,
          withdrawal: data,
        });
        
        // Use the signed transaction hex as the signature
        signature = "0x" + txHex;
        
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
