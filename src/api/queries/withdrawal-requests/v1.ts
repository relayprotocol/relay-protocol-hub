import { Type } from "@fastify/type-provider-typebox";

import { enhanceEncodedData } from "./utils";
import {
  Endpoint,
  ErrorResponse,
  FastifyReplyTypeBox,
  FastifyRequestTypeBox,
} from "../../utils";
import {
  getOffchainAllocatorForChain,
  getOnchainAllocatorForChain,
} from "../../../common/chains";
import { getSignature } from "../../../utils/onchain-allocator";
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
      }),
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
        },
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
    reply: FastifyReplyTypeBox<typeof Schema>,
  ) => {
    const withdrawalRequests = await getPendingWithdrawalRequestsByOwner(
      req.params.owner,
      req.query.chainId,
    );

    return reply.status(200).send({
      withdrawalRequests: await Promise.all(
        withdrawalRequests.map(async (w) => {
          let signer: string;
          let signature: string | undefined;
          let encodedData = w.encodedData;
          if (w.payloadId) {
            // Signed using "onchain" mode, signature might be available onchain
            signer = await getOnchainAllocatorForChain(w.chainId);
            signature = await getSignature(w.id);
            encodedData = await enhanceEncodedData(
              w.chainId,
              encodedData,
              signature,
            );
          } else {
            // Signed using "offchain" mode, signature already available
            signer = await getOffchainAllocatorForChain(w.chainId);
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
            encodedData,
            signer,
            signature,
          };
        }),
      ),
    });
  },
} as Endpoint;
