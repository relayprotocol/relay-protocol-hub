import { Type } from "@fastify/type-provider-typebox";

import {
  Endpoint,
  ErrorResponse,
  FastifyReplyTypeBox,
  FastifyRequestTypeBox,
} from "../../utils";
import { getAllocatorForChain } from "../../../common/chains";
import { getSignature } from "../../../common/onchain-allocator";
import { config } from "../../../config";
import { getPendingWithdrawalRequestsByOwner } from "../../../models/withdrawal-requests";

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
      withdrawalRequests: Type.Array(
        Type.Object({
          id: Type.String(),
          ownerChainId: Type.String(),
          owner: Type.String(),
          chainId: Type.String(),
          currency: Type.String(),
          amount: Type.String(),
          recipient: Type.String(),
          encodedData: Type.String(),
          signer: Type.String(),
          signature: Type.Optional(Type.String()),
        }),
        {
          description: "Pending withdrawal requests owned by the queried owner",
        }
      ),
    }),
    ...ErrorResponse,
  },
};

export default {
  method: "GET",
  url: "/queries/withdrawal-requests/:owner/v1",
  schema: Schema,
  handler: async (
    req: FastifyRequestTypeBox<typeof Schema>,
    reply: FastifyReplyTypeBox<typeof Schema>
  ) => {
    const withdrawalRequests = await getPendingWithdrawalRequestsByOwner(
      req.params.owner,
      req.query.chainId
    );

    return reply.status(200).send({
      withdrawalRequests: await Promise.all(
        withdrawalRequests.map(async (w) => {
          let signer: string;
          let signature: string | undefined;
          if (w.payloadId) {
            // Signed using "onchain" mode, signature might be available onchain
            signer = config.onchainAllocator!;
            signature = await getSignature(w.id);
          } else {
            // Signed using "offchain" mode, signature already available
            signer = await getAllocatorForChain(w.chainId);
            signature = w.signature;
          }

          return {
            id: w.id,
            ownerChainId: w.ownerChainId,
            owner: w.owner,
            chainId: w.chainId,
            currency: w.currency,
            amount: w.amount,
            recipient: w.recipient,
            encodedData: w.encodedData,
            signer,
            signature,
          };
        })
      ),
    });
  },
} as Endpoint;
