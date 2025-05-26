import { Type } from "@fastify/type-provider-typebox";
import { getSolverRefundMessageId } from "@reservoir0x/relay-protocol-sdk";
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
        order: Type.Object(
          {
            solverChainId: Type.String(),
            solver: Type.String(),
            salt: Type.String(),
            inputs: Type.Array(
              Type.Object({
                payment: Type.Object({
                  chainId: Type.String(),
                  currency: Type.String(),
                  amount: Type.String(),
                  weight: Type.String(),
                }),
                refunds: Type.Array(
                  Type.Object({
                    chainId: Type.String(),
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
              chainId: Type.String(),
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
                recipientChainId: Type.String(),
                recipient: Type.String(),
                currencyChainId: Type.String(),
                currency: Type.String(),
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
              description: "The index of the order input",
            }),
          })
        ),
        refunds: Type.Array(
          Type.Object({
            transactionId: Type.String({
              description: "The refund transaction",
            }),
            inputIndex: Type.Number({
              description: "The index of the order input",
            }),
            refundIndex: Type.Number({
              description: "The index of the order input refund",
            }),
          })
        ),
      }),
      result: Type.Object({
        orderId: Type.String({
          description: "The id of the attested order",
        }),
        status: Type.Number({
          description: "The status of the solver refund",
        }),
        totalWeightedInputPaymentBpsDiff: Type.String({
          description:
            "The bps difference between the quoted amount and the deposited amount",
        }),
      }),
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
  response: {
    200: Type.Object({
      message: Type.String({ description: "Success message" }),
    }),
    ...ErrorResponse,
  },
};

export default {
  method: "POST",
  url: "/actions/solver-refunds/v1",
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
    const messageId = getSolverRefundMessageId(
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
        return reply.status(400).send({
          message: "Invalid signature",
          code: "INVALID_SIGNATURE",
        });
      }
    }

    const actionExecutor = new ActionExecutorService();
    await actionExecutor.executeSolverRefund(message);

    return reply.status(200).send({ message: "Success" });
  },
} as Endpoint;
