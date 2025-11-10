import { Type } from "@fastify/type-provider-typebox";
import { verifyTypedData, zeroAddress } from "viem";

import {
  Endpoint,
  ErrorResponse,
  FastifyReplyTypeBox,
  FastifyRequestTypeBox,
} from "../../utils";
import { ChainMetadataEthereumVm, getChain } from "../../../common/chains";
import { externalError } from "../../../common/error";
import { saveNonceMapping } from "../../../models/nonce-mappings";

const Schema = {
  body: Type.Object({
    walletChainId: Type.String({
      description: "The chain id of the wallet",
    }),
    wallet: Type.String({
      description: "The wallet address",
    }),
    nonce: Type.String({
      description: "The nonce to associate the id to",
    }),
    id: Type.String({
      description: "The id to associate the nonce to",
    }),
    signatureChainId: Type.String({
      description: "The chain id of the signature",
    }),
    signature: Type.String({
      description: "The signature for the mapping",
    }),
  }),
  response: {
    200: Type.Object({
      message: Type.String({ description: "Success message" }),
    }),
    ...ErrorResponse,
  },
};

export default {
  method: "POST",
  url: "/actions/nonce-mappings/v1",
  schema: Schema,
  handler: async (
    req: FastifyRequestTypeBox<typeof Schema>,
    reply: FastifyReplyTypeBox<typeof Schema>
  ) => {
    const { walletChainId, wallet, nonce, id, signatureChainId, signature } =
      req.body;

    const NONCE_MAPPING_DOMAIN = (chainId: number) => ({
      name: "RelayNonceMapping",
      version: "1",
      chainId,
      verifyingContract: zeroAddress,
    });

    const NONCE_MAPPING_TYPES = {
      NonceMapping: [
        { name: "wallet", type: "address" },
        { name: "id", type: "bytes32" },
        { name: "nonce", type: "uint256" },
      ],
    };

    const message = {
      wallet: wallet as `0x${string}`,
      id: id as `0x${string}`,
      nonce: BigInt(nonce),
    };

    const signatureChain = await getChain(signatureChainId);
    if (signatureChain.vmType !== "ethereum-vm") {
      throw externalError("Unsupported signature chain", "INVALID_SIGNATURE");
    }

    const isValidSignature = await verifyTypedData({
      address: wallet as `0x${string}`,
      domain: NONCE_MAPPING_DOMAIN(
        (signatureChain.metadata as ChainMetadataEthereumVm).chainId
      ),
      types: NONCE_MAPPING_TYPES,
      primaryType: "NonceMapping",
      message,
      signature: signature as `0x${string}`,
    });
    if (!isValidSignature) {
      throw externalError("Invalid signature", "INVALID_SIGNATURE");
    }

    const saveResult = await saveNonceMapping({
      walletChainId,
      wallet,
      nonce,
      id,
      signatureChainId,
      signature,
    });
    if (!saveResult) {
      throw externalError(
        "Nonce mapping already exists",
        "NONCE_MAPPING_ALREADY_EXISTS"
      );
    }

    return reply.status(200).send({ message: "Success" });
  },
} as Endpoint;
