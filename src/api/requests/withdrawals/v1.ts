import { Type } from "@fastify/type-provider-typebox";

import {
  Endpoint,
  ErrorResponse,
  FastifyReplyTypeBox,
  FastifyRequestTypeBox,
} from "../../utils";
import { saveWithdrawalRequest } from "../../../models/withdrawal-requests";
import { RequestHandlerService } from "../../../services/request-handler";

const Schema = {
  body: Type.Object({
    ownerChainId: Type.String({ description: "The chain id of the owner" }),
    owner: Type.String({ description: "The address of the owner" }),
    chainId: Type.String({
      description: "The chain id to withdraw on",
    }),
    currency: Type.String({
      description: "The address of the currency to withdraw",
    }),
    amount: Type.String({
      description: "The amount to withdraw",
    }),
    recipient: Type.String({
      description: "The address of the recipient for the withdrawal proceeds",
    }),
  }),
  response: {
    200: Type.Object({
      id: Type.String({ description: "The id of the withdrawal" }),
      encodedData: Type.String({
        description:
          "The withdrawal data (encoded based on the withdrawing chain's vm type)",
      }),
      signature: Type.String({
        description: "The allocator signature for the withdrawal",
      }),
    }),
    ...ErrorResponse,
  },
};

export default {
  method: "POST",
  url: "/requests/withdrawals/v1",
  schema: Schema,
  handler: async (
    req: FastifyRequestTypeBox<typeof Schema>,
    reply: FastifyReplyTypeBox<typeof Schema>
  ) => {
    const requestHandler = new RequestHandlerService();
    const result = await requestHandler.handleWithdrawal(req.body);

    // Save the withdrawal request
    const withdrawalRequest = await saveWithdrawalRequest({
      id: result.id,
      ownerChainId: req.body.ownerChainId,
      owner: req.body.owner,
      chainId: req.body.chainId,
      currency: req.body.currency,
      amount: req.body.amount,
      recipient: req.body.recipient,
      encodedData: result.encodedData,
      signature: result.signature,
    });
    if (!withdrawalRequest) {
      return reply.status(400).send({
        message: "Failed to save withdrawal request",
        code: "SAVE_FAILED",
      });
    }

    return reply.status(200).send(result);
  },
} as Endpoint;
