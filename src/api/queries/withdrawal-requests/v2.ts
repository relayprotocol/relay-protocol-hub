import { Type } from "@fastify/type-provider-typebox";

import {
  Endpoint,
  ErrorResponse,
  FastifyReplyTypeBox,
  FastifyRequestTypeBox,
} from "../../utils";
import { getOnchainAllocator } from "../../../utils/onchain-allocator";
import { logger } from "../../../common/logger";
import { Hex } from "viem";

const Schema = {
  params: Type.Object({
    payloadId: Type.String({
      description: "The payload id of the withdrawal request",
    }),
  }),
  response: {
    200: Type.Object({
      encodedData: Type.String({
        description:
          "The depository payload to be executed on destination chain",
      }),
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
        msg: "Querying `withdrawal-signature` request from contract",
        data: req.body,
      })
    );
    const { contract } = await getOnchainAllocator();
    const encodedData = await contract.read.payloads([
      req.params.payloadId as Hex,
    ]);

    // TODO: return signature
    return reply.status(200).send({
      encodedData,
    });
  },
} as Endpoint;
