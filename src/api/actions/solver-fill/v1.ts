import { Type } from "@fastify/type-provider-typebox";
import {
  getSolverFillMessageId,
  SolverFillStatus,
} from "@reservoir0x/relay-protocol-sdk";
import { Address, Hex, verifyMessage } from "viem";

import {
  Endpoint,
  FastifyReplyTypeBox,
  FastifyRequestTypeBox,
} from "../../utils";
import { getSdkChainsConfig } from "../../../common/chains";
import { ActionExecutorService } from "../../../services/action-executor";

const Schema = {
  body: Type.Object({
    message: Type.Object({
      data: Type.Object({
        order: Type.Object(
          {
            solver: Type.Object({
              chainId: Type.Number(),
              address: Type.String(),
            }),
            salt: Type.String(),
            inputs: Type.Array(
              Type.Object({
                payment: Type.Object({
                  chainId: Type.Number(),
                  currency: Type.String(),
                  amount: Type.String(),
                  weight: Type.String(),
                }),
                refunds: Type.Array(
                  Type.Object({
                    chainId: Type.Number(),
                    recipient: Type.String(),
                    currency: Type.String(),
                    minimumAmount: Type.String(),
                    deadline: Type.Number(),
                    extraData: Type.String(),
                  })
                ),
              })
            ),
            output: Type.Object({
              chainId: Type.Number(),
              payments: Type.Array(
                Type.Object({
                  recipient: Type.String(),
                  currency: Type.String(),
                  minimumAmount: Type.String(),
                  expectedAmount: Type.String(),
                })
              ),
              calls: Type.Array(Type.String()),
              deadline: Type.Number(),
              extraData: Type.String(),
            }),
            fees: Type.Array(
              Type.Object({
                recipientChainId: Type.Number(),
                recipientAddress: Type.String(),
                currencyChainId: Type.Number(),
                currencyAddress: Type.String(),
                amount: Type.String(),
              })
            ),
          },
          {
            description: "The order data",
          }
        ),
        orderSignature: Type.String({
          description: "The solver signature of the order",
        }),
        inputs: Type.Array(
          Type.Object({
            transactionId: Type.String({
              description: "The transaction id of the deposit",
            }),
            onchainId: Type.String({
              description: "The onchain id of the deposit",
            }),
            inputIndex: Type.Number({
              description: "The index of the order input the deposit refers to",
            }),
          })
        ),
        fill: Type.Object({
          transactionId: Type.String({
            description: "The fill transaction",
          }),
        }),
      }),
      result: Type.Object({
        orderId: Type.String({
          description: "The id of the attested order",
        }),
        status: Type.Number({
          description: "The status of the solver fill",
        }),
        totalWeightedInputPaymentBpsDiff: Type.String({
          description:
            "The bps difference between the quoted amount and the deposited amount",
        }),
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
      code: Type.Union([
        Type.Literal("ALREADY_SAVED"),
        Type.Literal("ALREADY_LOCKED"),
        Type.Literal("SUCCESS"),
      ]),
    }),
    400: Type.Object({
      message: Type.String({ description: "Error message" }),
      code: Type.Union([
        Type.Literal("INSUFFICIENT_SIGNATURES"),
        Type.Literal("INVALID_SIGNATURE"),
        Type.Literal("INVALID_FILL"),
        Type.Literal("ALREADY_UNLOCKED"),
        Type.Literal("REALLOCATION_FAILED"),
        Type.Literal("UNKNOWN"),
      ]),
    }),
  },
};

export default {
  method: "POST",
  url: "/actions/solver-fill/v1",
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
    const messageId = getSolverFillMessageId(
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

    if (message.result.status !== SolverFillStatus.SUCCESSFUL) {
      return reply.status(400).send({
        message: "Invalid fill",
        code: "INVALID_FILL",
      });
    }

    const actionExecutor = new ActionExecutorService();
    const result = await actionExecutor.executeSolverFill(message);
    if (result.status === "success") {
      return reply.status(200).send({
        message: "Success",
        code: "SUCCESS",
      });
    } else {
      if (result.details === "already-unlocked") {
        return reply.status(400).send({
          message: "Part of the balance locks already unlocked",
          code: "ALREADY_UNLOCKED",
        });
      } else if (result.details === "reallocation-failed") {
        return reply.status(400).send({
          message: "Failed to reallocate balances",
          code: "REALLOCATION_FAILED",
        });
      } else {
        return reply.status(400).send({
          message: "Unknown error",
          code: "UNKNOWN",
        });
      }
    }
  },
} as Endpoint;
