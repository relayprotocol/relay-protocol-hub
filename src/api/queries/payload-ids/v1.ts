import { Type } from "@fastify/type-provider-typebox";

import {
  Endpoint,
  ErrorResponse,
  FastifyReplyTypeBox,
  FastifyRequestTypeBox,
} from "../../utils";
import { getChain } from "../../../common/chains";
import { RequestHandlerService } from "../../../services/request-handler";
import { getSubmitWithdrawRequestHash } from "@reservoir0x/relay-protocol-sdk";

const Schema = {
  body: Type.Object({
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
    spender: Type.String({
      description:
        "The address of the spender (usually the withdrawal address)",
    }),
    nonce: Type.String({
      description:
        "The nonce to be used when submitting the withdrawal request to the allocator",
    }),
    additionalData: Type.Optional(
      Type.Object(
        {
          "hyperliquid-vm": Type.Optional(
            Type.Object({
              currencyHyperliquidSymbol: Type.String({
                description: "The Hyperliquid symbol for the currency",
              }),
            })
          ),
        },
        {
          description:
            "Additional data needed for generating the withdrawal request",
        }
      )
    ),
  }),
  response: {
    200: Type.Object({
      payloadId: Type.String({
        description: "The payload id corresponding to the requested parameters",
      }),
    }),
    ...ErrorResponse,
  },
};

export default {
  method: "GET",
  url: "/queries/payload-ids/v1",
  schema: Schema,
  handler: async (
    req: FastifyRequestTypeBox<typeof Schema>,
    reply: FastifyReplyTypeBox<typeof Schema>
  ) => {
    const chain = await getChain(req.body.chainId);

    const requestHandler = new RequestHandlerService();
    const payloadParams = requestHandler.parseAllocatorPayloadParams(
      chain.vmType,
      chain.depository!,
      chain.metadata.allocatorChainId!,
      req.body.currency,
      req.body.amount,
      req.body.recipient,
      req.body.spender,
      req.body.nonce,
      req.body.additionalData
    );

    const payloadId = getSubmitWithdrawRequestHash(payloadParams);

    return reply.status(200).send({
      payloadId,
    });
  },
} as Endpoint;
