import { Type } from "@fastify/type-provider-typebox";

import {
  Endpoint,
  ErrorResponse,
  FastifyReplyTypeBox,
  FastifyRequestTypeBox,
} from "../../utils";
import { getBalanceLocksByOwner } from "../../../models/balances";

const Schema = {
  params: Type.Object({
    owner: Type.String({
      description: "The owner to query for",
    }),
  }),
  querystring: Type.Object({
    chainId: Type.Optional(
      Type.String({
        description: "The chain id to query for",
      })
    ),
  }),
  response: {
    200: Type.Object({
      balanceLocks: Type.Array(
        Type.Object({
          ownerChainId: Type.String(),
          owner: Type.String(),
          currencyChainId: Type.String(),
          currency: Type.String(),
          amount: Type.String(),
          expiration: Type.Optional(Type.Number()),
        }),
        {
          description: "Balance locks owned by the queried owner",
        }
      ),
    }),
    ...ErrorResponse,
  },
};

export default {
  method: "GET",
  url: "/queries/balance-locks/:owner/v1",
  schema: Schema,
  handler: async (
    req: FastifyRequestTypeBox<typeof Schema>,
    reply: FastifyReplyTypeBox<typeof Schema>
  ) => {
    const balanceLocks = await getBalanceLocksByOwner(
      req.params.owner,
      req.query.chainId
    );

    return reply.status(200).send({
      balanceLocks: balanceLocks.map((b) => ({
        ownerChainId: b.ownerChainId,
        owner: b.owner,
        currencyChainId: b.currencyChainId,
        currency: b.currency,
        amount: b.amount,
        expiration: b.expiration,
      })),
    });
  },
} as Endpoint;
