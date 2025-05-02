import { ITask } from "pg-promise";

import { DbEntry } from "./utils";
import { db } from "../common/db";

export type WithdrawalRequest = {
  id: string;
  ownerChainId: string;
  ownerAddress: string;
  chainId: string;
  currencyAddress: string;
  amount: string;
  recipientAddress: string;
  encodedData: string;
  signature: string;
  executed?: boolean;
};

export const getWithdrawalRequest = async (
  id: string,
  tx?: ITask<any>
): Promise<DbEntry<WithdrawalRequest> | undefined> => {
  const result = await (tx ?? db).oneOrNone(
    `
      SELECT
        withdrawal_requests.id,
        withdrawal_requests.owner_chain_id,
        withdrawal_requests.owner_address,
        withdrawal_requests.chain_id,
        withdrawal_requests.currency_address,
        withdrawal_requests.amount,
        withdrawal_requests.recipient_address,
        withdrawal_requests.encoded_data,
        withdrawal_requests.signature,
        withdrawal_requests.executed,
        withdrawal_requests.created_at,
        withdrawal_requests.updated_at
      FROM withdrawal_requests
      WHERE withdrawal_requests.id = $/id/
    `,
    {
      id,
    }
  );
  if (!result) {
    return undefined;
  }

  return {
    id: result.id,
    ownerChainId: result.owner_chain_id,
    ownerAddress: result.owner_address,
    chainId: result.chain_id,
    currencyAddress: result.currency_address,
    amount: result.amount,
    recipientAddress: result.recipient_address,
    encodedData: result.encoded_data,
    signature: result.signature,
    executed: result.executed,
    createdAt: result.created_at,
    updatedAt: result.updated_at,
  };
};

export const saveWithdrawalRequest = async (
  withdrawalRequest: WithdrawalRequest,
  tx?: ITask<any>
): Promise<DbEntry<WithdrawalRequest> | undefined> => {
  const result = await (tx ?? db).oneOrNone(
    `
      INSERT INTO withdrawal_requests (
        id,
        owner_chain_id,
        owner_address,
        chain_id,
        currency_address,
        amount,
        recipient_address,
        encoded_data,
        signature
      ) VALUES (
        $/id/,
        $/ownerChainId/,
        $/ownerAddress/,
        $/chainId/,
        $/currencyAddress/,
        $/amount/,
        $/recipientAddress/,
        $/encodedData/,
        $/signature/
      ) ON CONFLICT DO NOTHING
      RETURNING *
    `,
    {
      id: withdrawalRequest.id,
      ownerChainId: withdrawalRequest.ownerChainId,
      ownerAddress: withdrawalRequest.ownerAddress,
      chainId: withdrawalRequest.chainId,
      currencyAddress: withdrawalRequest.currencyAddress,
      amount: withdrawalRequest.amount,
      recipientAddress: withdrawalRequest.recipientAddress,
      encodedData: withdrawalRequest.encodedData,
      signature: withdrawalRequest.signature,
    }
  );
  if (!result) {
    return undefined;
  }

  return {
    id: result.id,
    ownerChainId: result.owner_chain_id,
    ownerAddress: result.owner_address,
    chainId: result.chain_id,
    currencyAddress: result.currency_address,
    amount: result.amount,
    recipientAddress: result.recipient_address,
    encodedData: result.encoded_data,
    signature: result.signature,
    executed: result.executed,
    createdAt: result.created_at,
    updatedAt: result.updated_at,
  };
};
