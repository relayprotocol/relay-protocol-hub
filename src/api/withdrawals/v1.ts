import { Type } from "@fastify/type-provider-typebox";

import {
  Endpoint,
  ErrorResponses,
  FastifyReplyTypeBox,
  FastifyRequestTypeBox,
} from "../utils";
import { getBalance } from "../../models/balances";

const Schema = {
  body: Type.Object({
    ownerChainId: Type.Number({ description: "The chain id of the owner" }),
    ownerAddress: Type.String({ description: "The address of the owner" }),
    currencyChainId: Type.Number({
      description: "The chain id of the currency",
    }),
    currencyAddress: Type.String({
      description: "The address of the currency",
    }),
    amount: Type.String({
      description: "The amount to withdraw",
    }),
  }),
  response: {
    ...ErrorResponses,
    200: Type.Object({
      status: Type.Literal("success"),
    }),
  },
};

export default {
  method: "POST",
  url: "/withdrawals/v1",
  schema: Schema,
  handler: async (
    req: FastifyRequestTypeBox<typeof Schema>,
    reply: FastifyReplyTypeBox<typeof Schema>
  ) => {
    const balance = await getBalance(
      req.body.ownerChainId,
      req.body.ownerAddress,
      req.body.currencyChainId,
      req.body.currencyAddress
    );
    if (!balance || BigInt(balance.availableAmount) < BigInt(req.body.amount)) {
      return reply.status(400).send({
        message: "Insufficient balance",
      });
    }

    return reply.send({ status: "success" });
  },
} as Endpoint;
