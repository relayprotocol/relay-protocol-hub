import { Type } from "@fastify/type-provider-typebox";
import { getDepositoryDepositMessageId } from "@reservoir0x/relay-protocol-sdk";
import { Address, Hex, verifyMessage } from "viem";

import {
  Endpoint,
  ErrorResponse,
  FastifyReplyTypeBox,
  FastifyRequestTypeBox,
} from "../../utils";
import { getSdkChainsConfig } from "../../../common/chains";
import { externalError } from "../../../common/error";
import { logger } from "../../../common/logger";
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
        depository: Type.String({
          description: "The depository address of the deposit",
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
      signatures: Type.Array(
        Type.Object({
          oracle: Type.String({
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
  url: "/actions/depository-deposits/v1",
  schema: Schema,
  handler: async (
    req: FastifyRequestTypeBox<typeof Schema>,
    reply: FastifyReplyTypeBox<typeof Schema>
  ) => {
    const message = req.body.message;

    const signatures = message.signatures;
    if (!signatures.length) {
      throw externalError(
        "At least one signature is required",
        "INSUFFICIENT_SIGNATURES"
      );
    }

    const messageId = getDepositoryDepositMessageId(
      message,
      await getSdkChainsConfig()
    );

    // TODO: Keep track of allowed oracles for every chain

    for (const { oracle, signature } of signatures) {
      const isSignatureValid = await verifyMessage({
        address: oracle as Address,
        message: {
          raw: messageId,
        },
        signature: signature as Hex,
      });
      if (!isSignatureValid) {
        throw externalError("Invalid signature", "INVALID_SIGNATURE");
      }
    }

    const actionExecutor = new ActionExecutorService();
    await actionExecutor.executeDepositoryDeposit(message);

    logger.info(
      "tracking",
      JSON.stringify({
        msg: "Executed `depository-deposit` action",
        action: message,
      })
    );

    return reply.status(200).send({ message: "Success" });
  },
} as Endpoint;
