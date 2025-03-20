import { Address, createWalletClient, hashTypedData, Hex, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";

import { ChainVmType, getChain } from "../common/chains";
import { config } from "../config";
import { WithdrawalRequest } from "../models/withdrawal-requests";

export const signWithdrawalRequestData = async (
  chainId: number,
  data: WithdrawalRequest["data"]
): Promise<{
  id: string;
  signature: string;
}> => {
  const chain = await getChain(chainId);
  switch (chain.vmType) {
    case ChainVmType.EthereumVM: {
      const walletClient = createWalletClient({
        account: privateKeyToAccount(config.ecdsaPrivateKey as Hex),
        // Viem will error if we pass no URL to the `http` transport, so here we
        // just pass a mock URL, which isn't even going to be used since we only
        // use `walletClient` for signing messages offchain
        transport: http("http://localhost:1"),
      });

      const typedData = {
        domain: {
          name: "RelayEscrow",
          version: "1",
          chainId,
          verifyingContract: chain.metadata.escrow as Address,
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

      return {
        id: hashTypedData(typedData),
        signature: await walletClient.signTypedData(typedData),
      };
    }

    default: {
      throw new Error(
        `Signing withdrawal requests not supported for ${chain.vmType}`
      );
    }
  }
};
