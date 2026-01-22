import { Type } from "@fastify/type-provider-typebox";
import { createHash } from "crypto";
import { Address, encodePacked, Hex, verifyMessage } from "viem";

import {
  AdditionalDataSchema,
  Endpoint,
  ErrorResponse,
  FastifyReplyTypeBox,
  FastifyRequestTypeBox,
  SubmitWithdrawalRequestParamsSchema,
} from "../../utils";
import { getChain } from "../../../common/chains";
import { externalError } from "../../../common/error";
import { logger } from "../../../common/logger";
import { RequestHandlerService } from "../../../services/request-handler";

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
    additionalData: Type.Optional(AdditionalDataSchema),
    owner: Type.String({
      description: "The address of the owner (that triggered the withdrawal)",
    }),
    ownerChainId: Type.String({ description: "The chain id of the owner" }),
    signature: Type.String({
      description:
        "Signature attesting the owner authorized this particular withdrawal request",
    }),
  }),
  response: {
    200: Type.Object({
      id: Type.String({ description: "The id of the withdrawal" }),
      encodedData: Type.String({
        description:
          "The withdrawal data (encoded based on the withdrawing chain's vm type)",
      }),
      signer: Type.String({ description: "The signer of the withdrawal" }),
      submitWithdrawalRequestParams: Type.Optional(
        SubmitWithdrawalRequestParamsSchema
      ),
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
  url: "/requests/withdrawals/v2",
  schema: Schema,
  handler: async (
    req: FastifyRequestTypeBox<typeof Schema>,
    reply: FastifyReplyTypeBox<typeof Schema>
  ) => {
    // make sure we got EVM sig
    const signatureVmType = await getChain(req.body.ownerChainId).then(
      (c) => c.vmType
    );
    if (signatureVmType !== "ethereum-vm") {
      throw externalError(
        "Only 'ethereum-vm' signatures are supported",
        "UNSUPPORTED_SIGNATURE"
      );
    }

    // recompute proof computed on the oracle
    const proofOfWithdrawalAddressBalance = encodePacked(
      ["address", "uint256", "bytes32"],
      [
        req.body.spender as `0x${string}`, // withdrawalAddress
        BigInt(req.body.amount),
        req.body.nonce as `0x${string}`,
      ]
    );

    // authentify the proof of withdrawal address balance
    const hash = createHash("sha256")
      .update(proofOfWithdrawalAddressBalance)
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

    logger.info(
      "tracking",
      JSON.stringify({
        msg: "Executing `withdrawal` request (v2)",
        request: req.body,
      })
    );

    const requestHandler = new RequestHandlerService();

    // Extract only the fields expected by the handler (exclude signature which is only for validation)
    const { signature: _, ...requestBody } = req.body;
    const result = await requestHandler.handleOnChainWithdrawal(requestBody);

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
