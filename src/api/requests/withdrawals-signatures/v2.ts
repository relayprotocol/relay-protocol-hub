import { Type } from "@fastify/type-provider-typebox";

import {
  Endpoint,
  ErrorResponse,
  FastifyReplyTypeBox,
  FastifyRequestTypeBox,
} from "../../utils";
import { logger } from "../../../common/logger";
import { RequestHandlerService } from "../../../services/request-handler";

const Schema = {
  body: Type.Object({
    chainId: Type.String({
      description: "The chain id of the withdrawal",
    }),
    payloadId: Type.String({
      description: "The payload id of the withdrawal request",
    }),
    payloadParams: Type.Object({
      chainId: Type.String({
        description: "The chain id of the allocator",
      }),
      depository: Type.String({
        description: "The depository address of the allocator",
      }),
      currency: Type.String({
        description: "The currency to withdraw",
      }),
      amount: Type.String({
        description: "The amount to withdraw",
      }),
      spender: Type.String({
        description: "The address of the spender",
      }),
      receiver: Type.String({
        description: "The address of the receiver on the depository chain",
      }),
      data: Type.String({
        description: "The data to include in the withdrawal request",
      }),
      nonce: Type.String({
        description: "The nonce to include in the withdrawal request",
      }),
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
  url: "/requests/withdrawals/signatures/v2",
  schema: Schema,
  handler: async (
    req: FastifyRequestTypeBox<typeof Schema>,
    reply: FastifyReplyTypeBox<typeof Schema>
  ) => {
    logger.info(
      "tracking",
      JSON.stringify({
        msg: "Executing `withdrawal-signature` request",
        data: req.body,
      })
    );

    const requestHandler = new RequestHandlerService();
    const result = await requestHandler.handleOnChainWithdrawalSignature(
      req.body
    );

    logger.info(
      "tracking",
      JSON.stringify({
        msg: "Executed `withdrawal-signature` request",
        data: req.body,
        result,
      })
    );

    return reply.status(200).send({
      message: "Success",
    });
  },
} as Endpoint;
