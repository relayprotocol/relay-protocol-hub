import { ITask } from "pg-promise";

import { Balance } from "./balances";
import { DbEntry } from "./utils";
import { db } from "../common/db";

export type TransactionEntry = {
  chainId: number;
  transactionId: string;
  entryId: string;
  ownerChainId: number;
  ownerAddress: string;
  currencyAddress: string;
  balanceDiff: string;
};

export const getTransactionEntry = async (
  chainId: number,
  transactionId: string,
  entryId: string,
  tx?: ITask<any>
): Promise<DbEntry<TransactionEntry> | undefined> => {
  const result = await (tx ?? db).oneOrNone(
    `
      SELECT
        transaction_entries.chain_id,
        transaction_entries.transaction_id,
        transaction_entries.entry_id,
        transaction_entries.owner_chain_id,
        transaction_entries.owner_address,
        transaction_entries.currency_address,
        transaction_entries.balance_diff,
        transaction_entries.created_at,
        transaction_entries.updated_at
      FROM transaction_entries
      WHERE transaction_entries.chain_id = $/chainId/
        AND transaction_entries.transaction_id = $/transactionId/
        AND transaction_entries.entry_id = $/entryId/
    `,
    {
      chainId,
      transactionId,
      entryId,
    }
  );
  if (!result) {
    return undefined;
  }

  return {
    chainId: result.chain_id,
    transactionId: result.transaction_id,
    entryId: result.entry_id,
    ownerChainId: result.owner_chain_id,
    ownerAddress: result.owner_address,
    currencyAddress: result.currency_address,
    balanceDiff: result.balance_diff,
    createdAt: result.created_at,
    updatedAt: result.updated_at,
  };
};

export const saveTransactionEntryWithBalanceUpdate = async (
  transactionEntry: TransactionEntry,
  tx?: ITask<any>
): Promise<DbEntry<Balance> | undefined> => {
  const result = await (tx ?? db).oneOrNone(
    `
      WITH x AS (
        INSERT INTO transaction_entries (
          chain_id,
          transaction_id,
          entry_id,
          owner_chain_id,
          owner_address,
          currency_address,
          balance_diff
        ) VALUES (
          $/chainId/,
          $/transactionId/,
          $/entryId/,
          $/ownerChainId/,
          $/ownerAddress/,
          $/currencyAddress/,
          $/balanceDiff/
        ) ON CONFLICT DO NOTHING
        RETURNING *
      )
      INSERT INTO balances (
        owner_chain_id,
        owner_address,
        currency_chain_id,
        currency_address,
        available_amount
      ) (
        SELECT
          x.owner_chain_id,
          x.owner_address,
          x.chain_id,
          x.currency_address,
          x.balance_diff
        FROM x
      )
      ON CONFLICT (owner_chain_id, owner_address, currency_chain_id, currency_address)
      DO UPDATE SET
        available_amount = balances.available_amount + EXCLUDED.available_amount,
        updated_at = now()
      RETURNING *
    `,
    {
      chainId: transactionEntry.chainId,
      transactionId: transactionEntry.transactionId,
      entryId: transactionEntry.entryId,
      ownerChainId: transactionEntry.ownerChainId,
      ownerAddress: transactionEntry.ownerAddress,
      currencyAddress: transactionEntry.currencyAddress,
      balanceDiff: transactionEntry.balanceDiff,
    }
  );
  if (!result) {
    return undefined;
  }

  return {
    ownerChainId: result.owner_chain_id,
    ownerAddress: result.owner_address,
    currencyChainId: result.currency_chain_id,
    currencyAddress: result.currency_address,
    availableAmount: result.available_amount,
    lockedAmount: result.locked_amount,
    createdAt: result.created_at,
    updatedAt: result.updated_at,
  };
};
