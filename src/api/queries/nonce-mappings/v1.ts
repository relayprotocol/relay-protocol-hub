import { Type } from "@fastify/type-provider-typebox";

import {
  Endpoint,
  ErrorResponse,
  FastifyReplyTypeBox,
  FastifyRequestTypeBox,
} from "../../utils";
import { externalError } from "../../../common/error";
import { getNonceMapping } from "../../../models/nonce-mappings";

const Schema = {
  params: Type.Object({
    walletChainId: Type.String({
      description: "The chain id of the wallet",
    }),
    wallet: Type.String({
      description: "The wallet address",
    }),
    nonce: Type.String({
      description: "The nonce to lookup",
    }),
  }),
  response: {
    200: Type.Object({
      walletChainId: Type.String(),
      wallet: Type.String(),
      nonce: Type.String(),
      id: Type.String(),
      signatureChainId: Type.String(),
      signature: Type.String(),
      createdAt: Type.String(),
    }),
    ...ErrorResponse,
  },
};

export default {
  method: "GET",
  url: "/queries/nonce-mappings/:walletChainId/:wallet/:nonce/v1",
  schema: Schema,
  handler: async (
    req: FastifyRequestTypeBox<typeof Schema>,
    reply: FastifyReplyTypeBox<typeof Schema>
  ) => {
    const { walletChainId, wallet, nonce } = req.params;

    const nonceMapping = await getNonceMapping(walletChainId, wallet, nonce);
    if (!nonceMapping) {
      throw externalError("Nonce mapping not found", "NONCE_MAPPING_NOT_FOUND");
    }

    return reply.status(200).send({
      walletChainId: nonceMapping.walletChainId,
      wallet: nonceMapping.wallet,
      nonce: nonceMapping.nonce,
      id: nonceMapping.id,
      signatureChainId: nonceMapping.signatureChainId,
      signature: nonceMapping.signature,
      createdAt: nonceMapping.createdAt.toISOString(),
    });
  },
} as Endpoint;
