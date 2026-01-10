import { Type } from "@fastify/type-provider-typebox";

import {
  Endpoint,
  ErrorResponse,
  FastifyReplyTypeBox,
  FastifyRequestTypeBox,
} from "../../utils";
import {
  getOnchainAllocator,
  getSignatureFromContract,
  getSigner,
} from "../../../utils/onchain-allocator";
import { logger } from "../../../common/logger";
import { Hex } from "viem";

const Schema = {
  params: Type.Object({
    payloadId: Type.String({
      description: "The payload id of the withdrawal request",
    }),
  }),
  querystring: Type.Object({
    chainId: Type.String({
      description: "The chain id of the depository",
    }),
  }),
  response: {
    200: Type.Object({
      encodedData: Type.String({
        description:
          "The depository payload to be executed on destination chain",
      }),
      signature: Type.Optional(
        Type.String({
          description:
            "The sign data hash to be passed to the depository for execution",
        })
      ),
      signer: Type.Optional(
        Type.String({
          description: "The MPC signer that signed the depository payload",
        })
      ),
    }),
    ...ErrorResponse,
  },
};

export default {
  method: "GET",
  url: "/queries/withdrawal-requests/:payloadId/v2",
  schema: Schema,
  handler: async (
    req: FastifyRequestTypeBox<typeof Schema>,
    reply: FastifyReplyTypeBox<typeof Schema>
  ) => {
    logger.info(
      "tracking",
      JSON.stringify({
        msg: "Querying if withdrawal exists from the Allocator contract",
        data: req.body,
      })
    );
    const { contract } = await getOnchainAllocator();
    const encodedData = await contract.read.payloads([
      req.params.payloadId as Hex,
    ]);

    let signature;
    let signer;

    if (encodedData !== "0x") {
      signature = await getSignatureFromContract(
        req.query.chainId,
        req.params.payloadId,
        encodedData
      );

      signer = await getSigner(req.query.chainId);
    }

    return reply.status(200).send({
      encodedData,
      signature,
      signer,
    });
  },
} as Endpoint;
