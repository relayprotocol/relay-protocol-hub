import { ITask } from "pg-promise";

import { DbEntry, nvAddress, nvBytes, nvCurrency } from "./utils";
import { getChain } from "../common/chains";
import { db } from "../common/db";

export type Balance = {
  ownerChainId: number;
  ownerAddress: string;
  currencyChainId: number;
  currencyAddress: string;
  availableAmount: string;
  lockedAmount: string;
};

export type BalanceLock = {
  id: string;
  ownerChainId: number;
  ownerAddress: string;
  currencyChainId: number;
  currencyAddress: string;
  amount: string;
  expiration?: number;
  executed?: boolean;
};

export const getBalance = async (
  ownerChainId: number,
  ownerAddress: string,
  currencyChainId: number,
  currencyAddress: string,
  options?: {
    tx?: ITask<any>;
  }
): Promise<DbEntry<Balance> | undefined> => {
  const result = await (options?.tx ?? db).oneOrNone(
    `
      SELECT
        balances.owner_chain_id,
        balances.owner_address,
        balances.currency_chain_id,
        balances.currency_address,
        balances.available_amount,
        balances.locked_amount,
        balances.created_at,
        balances.updated_at
      FROM balances
      WHERE balances.owner_chain_id = $/ownerChainId/
        AND balances.owner_address = $/ownerAddress/
        AND balances.currency_chain_id = $/currencyChainId/
        AND balances.currency_address = $/currencyAddress/
    `,
    {
      ownerChainId,
      ownerAddress,
      currencyChainId,
      currencyAddress,
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

export const initializeBalance = async (
  ownerChainId: number,
  ownerAddress: string,
  currencyChainId: number,
  currencyAddress: string,
  options?: {
    tx?: ITask<any>;
  }
): Promise<DbEntry<Balance> | undefined> => {
  const ownerVmType = await getChain(ownerChainId).then(
    (chain) => chain.vmType
  );
  const currencyVmType = await getChain(currencyChainId).then(
    (chain) => chain.vmType
  );

  const result = await (options?.tx ?? db).oneOrNone(
    `
      INSERT INTO balances (
        owner_chain_id,
        owner_address,
        currency_chain_id,
        currency_address,
        available_amount,
        locked_amount
      ) VALUES (
        $/ownerChainId/,
        $/ownerAddress/,
        $/currencyChainId/,
        $/currencyAddress/,
        0,
        0
      ) ON CONFLICT DO NOTHING
    `,
    {
      ownerChainId,
      ownerAddress: nvAddress(ownerAddress, ownerVmType),
      currencyChainId,
      currencyAddress: nvCurrency(currencyAddress, currencyVmType),
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

export const getBalanceLock = async (
  balanceLockId: string,
  options?: {
    tx?: ITask<any>;
  }
): Promise<DbEntry<BalanceLock> | undefined> => {
  const result = await (options?.tx ?? db).oneOrNone(
    `
      SELECT
        balance_locks.id,
        balance_locks.owner_chain_id,
        balance_locks.owner_address,
        balance_locks.currency_chain_id,
        balance_locks.currency_address,
        balance_locks.amount,
        balance_locks.expiration,
        balance_locks.created_at,
        balance_locks.updated_at
      FROM balance_locks
      WHERE balance_locks.id = $/balanceLockId/
    `,
    {
      balanceLockId,
    }
  );
  if (!result) {
    return undefined;
  }

  return {
    id: result.id,
    ownerChainId: result.owner_chain_id,
    ownerAddress: result.owner_address,
    currencyChainId: result.currency_chain_id,
    currencyAddress: result.currency_address,
    amount: result.amount,
    expiration: result.expiration ?? undefined,
    executed: result.executed ?? undefined,
    createdAt: result.created_at,
    updatedAt: result.updated_at,
  };
};

export const saveBalanceLock = async (
  balanceLock: BalanceLock,
  options?: {
    tx?: ITask<any>;
  }
): Promise<DbEntry<Balance> | undefined> => {
  const ownerVmType = await getChain(balanceLock.ownerChainId).then(
    (chain) => chain.vmType
  );
  const currencyVmType = await getChain(balanceLock.currencyChainId).then(
    (chain) => chain.vmType
  );

  const result = await (options?.tx ?? db).oneOrNone(
    `
      WITH x AS (
        INSERT INTO balance_locks (
          id,
          owner_chain_id,
          owner_address,
          currency_chain_id,
          currency_address,
          amount,
          expiration
        ) VALUES (
          $/id/,
          $/ownerChainId/,
          $/ownerAddress/,
          $/currencyChainId/,
          $/currencyAddress/,
          $/amount/,
          $/expiration/
        ) ON CONFLICT DO NOTHING
        RETURNING *
      )
      UPDATE balances SET
        available_amount = balances.available_amount - x.amount,
        locked_amount = balances.locked_amount + x.amount,
        updated_at = now()
      FROM x
      WHERE balances.owner_chain_id = x.owner_chain_id
        AND balances.owner_address = x.owner_address
        AND balances.currency_chain_id = x.currency_chain_id
        AND balances.currency_address = x.currency_address
      RETURNING *
    `,
    {
      id: nvBytes(balanceLock.id, 32),
      ownerChainId: balanceLock.ownerChainId,
      ownerAddress: nvAddress(balanceLock.ownerAddress, ownerVmType),
      currencyChainId: balanceLock.currencyChainId,
      currencyAddress: nvCurrency(balanceLock.currencyAddress, currencyVmType),
      amount: balanceLock.amount,
      expiration: balanceLock.expiration ?? null,
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

export const unlockBalanceLock = async (
  balanceLockId: string,
  options?: {
    // When set, this results in the total balance being reduced,
    // otherwise the total balance stays the same, while only the
    // available / locked ratio changes.
    skipAvailableBalanceAdjustment?: boolean;
    tx?: ITask<any>;
  }
): Promise<DbEntry<Balance> | undefined> => {
  const result = await (options?.tx ?? db).oneOrNone(
    `
      WITH
        x AS (
          UPDATE balance_locks SET
            executed = TRUE,
            updated_at = now()
          WHERE balance_locks.id = $/balanceLockId/
            AND NOT balance_locks.executed
          RETURNING
            balance_locks.owner_chain_id,
            balance_locks.owner_address,
            balance_locks.currency_chain_id,
            balance_locks.currency_address,
            balance_locks.amount
        )
        UPDATE balances SET
          ${
            options?.skipAvailableBalanceAdjustment
              ? ""
              : "available_amount = balances.available_amount + x.amount,"
          }
          locked_amount = balances.locked_amount - x.amount,
          updated_at = now()
        FROM x
        WHERE balances.owner_chain_id = x.owner_chain_id
          AND balances.owner_address = x.owner_address
          AND balances.currency_chain_id = x.currency_chain_id
          AND balances.currency_address = x.currency_address
        RETURNING *
    `,
    {
      balanceLockId,
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

export const reallocateBalance = async (
  from: Pick<
    Balance,
    "ownerChainId" | "ownerAddress" | "currencyChainId" | "currencyAddress"
  >,
  to: Pick<Balance, "ownerChainId" | "ownerAddress">,
  amount: string,
  options?: {
    tx?: ITask<any>;
  }
): Promise<DbEntry<Balance>[]> => {
  const fromOwnerVmType = await getChain(from.ownerChainId).then(
    (chain) => chain.vmType
  );
  const fromCurrencyVmType = await getChain(from.currencyChainId).then(
    (chain) => chain.vmType
  );
  const toOwnerVmType = await getChain(to.ownerChainId).then(
    (chain) => chain.vmType
  );

  const results = await (options?.tx ?? db).manyOrNone(
    `
      WITH
        x(owner_chain_id, owner_address, currency_chain_id, currency_address, balance_diff) AS (
          VALUES
            (
              $/fromOwnerChainId/::BIGINT,
              $/fromOwnerAddress/::TEXT,
              $/fromCurrencyChainId/::BIGINT,
              $/fromCurrencyAddress/::TEXT,
              -$/amount/::NUMERIC(78, 0)
            ),
            (
              $/toOwnerChainId/,
              $/toOwnerAddress/,
              $/fromCurrencyChainId/,
              $/fromCurrencyAddress/,
              $/amount/
            )
        )
        UPDATE balances SET
          available_amount = balances.available_amount + x.balance_diff,
          updated_at = now()
        FROM x
        WHERE balances.owner_chain_id = x.owner_chain_id
          AND balances.owner_address = x.owner_address
          AND balances.currency_chain_id = x.currency_chain_id
          AND balances.currency_address = x.currency_address
        RETURNING *
    `,
    {
      fromOwnerChainId: from.ownerChainId,
      fromOwnerAddress: nvAddress(from.ownerAddress, fromOwnerVmType),
      fromCurrencyChainId: from.currencyChainId,
      fromCurrencyAddress: nvCurrency(from.currencyAddress, fromCurrencyVmType),
      toOwnerChainId: to.ownerChainId,
      toOwnerAddress: nvAddress(to.ownerAddress, toOwnerVmType),
      amount,
    }
  );

  return results.map((result) => ({
    ownerChainId: result.owner_chain_id,
    ownerAddress: result.owner_address,
    currencyChainId: result.currency_chain_id,
    currencyAddress: result.currency_address,
    availableAmount: result.available_amount,
    lockedAmount: result.locked_amount,
    createdAt: result.created_at,
    updatedAt: result.updated_at,
  }));
};
