import { Type } from "@fastify/type-provider-typebox";
import { createHash } from "crypto";
import stringify from "json-stable-stringify";
import { Address, Hex, verifyMessage } from "viem";

import {
  Endpoint,
  ErrorResponse,
  FastifyReplyTypeBox,
  FastifyRequestTypeBox,
} from "../../utils";
import { getChain } from "../../../common/chains";
import { externalError } from "../../../common/error";
import { logger } from "../../../common/logger";
import { RequestHandlerService } from "../../../services/request-handler";

const Schema = {
  body: Type.Object({
    mode: Type.Optional(
      Type.Union([Type.Literal("offchain"), Type.Literal("onchain")], {
        description: "Allocation mode to use",
      })
    ),
    ownerChainId: Type.String({ description: "The chain id of the owner" }),
    owner: Type.String({ description: "The address of the owner" }),
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
    signature: Type.Optional(
      Type.String({
        description:
          "Signature attesting the owner authorized this particular withdrawal request",
      })
    ),
    additionalData: Type.Optional(
      Type.Object(
        {
          "bitcoin-vm": Type.Optional(
            Type.Object({
              allocatorUtxos: Type.Array(
                Type.Object(
                  {
                    txid: Type.String(),
                    vout: Type.Number(),
                    value: Type.String(),
                  },
                  {
                    description:
                      "Allocator UTXOs to be used for generating the withdrawal request",
                  }
                )
              ),
              relayer: Type.String({
                description: "The address of the relayer",
              }),
              relayerUtxos: Type.Array(
                Type.Object(
                  {
                    txid: Type.String(),
                    vout: Type.Number(),
                    value: Type.String(),
                  },
                  {
                    description:
                      "Relayer UTXOs to be used for the transaction fee payment",
                  }
                )
              ),
              transactionFee: Type.String({
                description:
                  "The transaction fee taken out of the specified relayer UTXOs",
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
      id: Type.String({ description: "The id of the withdrawal" }),
      encodedData: Type.String({
        description:
          "The withdrawal data (encoded based on the withdrawing chain's vm type)",
      }),
      signer: Type.String({ description: "The signer of the withdrawal" }),
      signature: Type.Optional(
        Type.String({
          description: "The allocator signature for the withdrawal",
        })
      ),
    }),
    ...ErrorResponse,
  },
};

export default {
  method: "POST",
  url: "/requests/withdrawals/v1",
  schema: Schema,
  handler: async (
    req: FastifyRequestTypeBox<typeof Schema>,
    reply: FastifyReplyTypeBox<typeof Schema>
  ) => {
    if (req.body.signature) {
      const signatureVmType = await getChain(req.body.ownerChainId).then(
        (c) => c.vmType
      );
      if (signatureVmType !== "ethereum-vm") {
        throw externalError(
          "Only 'ethereum-vm' signatures are supported",
          "UNSUPPORTED_SIGNATURE"
        );
      }

      const hash = createHash("sha256")
        .update(
          stringify({
            ...req.body,
            signature: undefined,
          })!
        )
        .digest("hex");
      const isSignatureValid = await verifyMessage({
        address: req.body.owner as Address,
        message: {
          raw: `0x${hash}`,
        },
        signature: req.body.signature as Hex,
      });
      if (!isSignatureValid) {
        throw externalError("Invalid signature", "INVALID_SIGNATURE");
      }
    }

    logger.info(
      "tracking",
      JSON.stringify({
        msg: "Executing `withdrawal` request",
        request: req.body,
      })
    );

    const requestHandler = new RequestHandlerService();
    const result = await requestHandler.handleWithdrawal(req.body);

    logger.info(
      "tracking",
      JSON.stringify({
        msg: "Executed `withdrawal` request",
        request: req.body,
        result,
      })
    );

    return reply.status(200).send(result);
  },
} as Endpoint;
