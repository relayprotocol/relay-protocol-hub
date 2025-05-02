import { Type } from "@fastify/type-provider-typebox";
import { getEscrowDepositMessageId } from "@reservoir0x/relay-protocol-sdk";
import { Address, Hex, verifyMessage } from "viem";

import {
  Endpoint,
  ErrorResponse,
  FastifyReplyTypeBox,
  FastifyRequestTypeBox,
} from "../../utils";
import { getSdkChainsConfig } from "../../../common/chains";
import { ActionExecutorService } from "../../../services/action-executor";

const Schema = {
  body: Type.Object({
    message: Type.Object({
      data: Type.Object({
        chainId: Type.String({
          description: "The chain id of the attested transaction",
        }),
        transactionId: Type.String({
          description: "The id of the attested transaction",
        }),
      }),
      result: Type.Object({
        onchainId: Type.String({
          description: "The onchain id of the deposit",
        }),
        escrow: Type.String({
          description: "The escrow address of the deposit",
        }),
        depositId: Type.String({
          description: "The id associated to the deposit",
        }),
        depositor: Type.String({
          description: "The address of the depositor",
        }),
        currency: Type.String({
          description: "The address of the deposited currency",
        }),
        amount: Type.String({ description: "The deposited amount" }),
      }),
    }),
    signatures: Type.Array(
      Type.Object({
        oracleAddress: Type.String({
          description: "The ethereum-vm address of the signing oracle",
        }),
        signature: Type.String({
          description: "The corresponding oracle signature",
        }),
      }),
      {
        minItems: 1,
      }
    ),
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
  url: "/actions/escrow-deposits/v1",
  schema: Schema,
  handler: async (
    req: FastifyRequestTypeBox<typeof Schema>,
    reply: FastifyReplyTypeBox<typeof Schema>
  ) => {
    const signatures = req.body.signatures;
    if (!signatures.length) {
      return reply.status(400).send({
        message: "At least one signature is required",
        code: "INSUFFICIENT_SIGNATURES",
      });
    }

    const message = req.body.message;
    const messageId = getEscrowDepositMessageId(
      message,
      await getSdkChainsConfig()
    );

    // TODO: Keep track of allowed oracles for every chain

    for (const { oracleAddress, signature } of signatures) {
      const isSignatureValid = await verifyMessage({
        address: oracleAddress as Address,
        message: {
          raw: messageId,
        },
        signature: signature as Hex,
      });
      if (!isSignatureValid) {
        return reply.status(400).send({
          message: "Invalid signature",
          code: "INVALID_SIGNATURE",
        });
      }
    }

    const actionExecutor = new ActionExecutorService();
    await actionExecutor.executeEscrowDeposit(message);

    return reply.status(200).send({ message: "Success" });
  },
} as Endpoint;
