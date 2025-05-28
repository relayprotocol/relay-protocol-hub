import { Type } from "@fastify/type-provider-typebox";

import {
  Endpoint,
  ErrorResponse,
  FastifyReplyTypeBox,
  FastifyRequestTypeBox,
} from "../../utils";
import { getBalancesByOwner } from "../../../models/balances";

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
      balances: Type.Array(
        Type.Object({
          ownerChainId: Type.String(),
          owner: Type.String(),
          currencyChainId: Type.String(),
          currency: Type.String(),
          availableAmount: Type.String(),
          lockedAmount: Type.String(),
        }),
        {
          description: "Balances owned by the queried owner",
        }
      ),
    }),
    ...ErrorResponse,
  },
};

export default {
  method: "GET",
  url: "/queries/balances/:owner/v1",
  schema: Schema,
  handler: async (
    req: FastifyRequestTypeBox<typeof Schema>,
    reply: FastifyReplyTypeBox<typeof Schema>
  ) => {
    const balances = await getBalancesByOwner(
      req.params.owner,
      req.query.chainId
    );

    return reply.status(200).send({
      balances: balances.map((b) => ({
        ownerChainId: b.ownerChainId,
        owner: b.owner,
        currencyChainId: b.currencyChainId,
        currency: b.currency,
        availableAmount: b.availableAmount,
        lockedAmount: b.lockedAmount,
      })),
    });
  },
} as Endpoint;
