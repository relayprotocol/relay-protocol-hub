import { Type } from "@fastify/type-provider-typebox";

import {
  Endpoint,
  ErrorResponse,
  FastifyReplyTypeBox,
  FastifyRequestTypeBox,
} from "../../utils";
import { getOnchainEntriesByChainIdAndTransactionId } from "../../../models/onchain-entries";

const Schema = {
  params: Type.Object({
    chainId: Type.String({
      description: "The chain id to query",
    }),
    transactionId: Type.String({
      description: "The transaction id to query",
    }),
  }),
  response: {
    200: Type.Object({
      depositoryDeposits: Type.Array(
        Type.Object({
          id: Type.String({ description: "The id of the deposit" }),
          chainId: Type.String({ description: "The chain id of the deposit" }),
          transactionId: Type.String({
            description: "The transaction id of the deposit",
          }),
          depositor: Type.String({ description: "The depositor" }),
          currency: Type.String({ description: "The deposited currency" }),
          amount: Type.String({ description: "The deposited amount" }),
        }),
        {
          description: "A list of deposits",
        }
      ),
    }),
    ...ErrorResponse,
  },
};

export default {
  method: "GET",
  url: "/queries/depository-deposits/:chainId/:transactionId/v1",
  schema: Schema,
  handler: async (
    req: FastifyRequestTypeBox<typeof Schema>,
    reply: FastifyReplyTypeBox<typeof Schema>
  ) => {
    return reply.status(200).send({
      depositoryDeposits: await getOnchainEntriesByChainIdAndTransactionId(
        req.params.chainId,
        req.params.transactionId
      ).then((entries) =>
        entries.map((e) => ({
          id: e.id,
          chainId: e.chainId,
          transactionId: e.transactionId,
          depositor: e.owner,
          currency: e.currency,
          amount: e.balanceDiff,
        }))
      ),
    });
  },
} as Endpoint;
