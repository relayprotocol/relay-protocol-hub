import { DbEntry } from "./utils";
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
  currencyAddress: string
): Promise<DbEntry<Balance> | undefined> => {
  const result = await db.oneOrNone(
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

export const getBalanceLock = async (
  balanceLockId: string
): Promise<DbEntry<BalanceLock> | undefined> => {
  const result = await db.oneOrNone(
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
  balanceLock: BalanceLock
): Promise<DbEntry<Balance> | undefined> => {
  const result = await db.oneOrNone(
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
      id: balanceLock.id,
      ownerChainId: balanceLock.ownerChainId,
      ownerAddress: balanceLock.ownerAddress,
      currencyChainId: balanceLock.currencyChainId,
      currencyAddress: balanceLock.currencyAddress,
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
  recipientChainId: number,
  recipientAddress: string
): Promise<DbEntry<Balance>[]> => {
  const balanceLock = await getBalanceLock(balanceLockId);
  if (!balanceLock) {
    throw new Error("Balance lock does not exist");
  }

  let results: any[];

  // We have different logic depending on whether the recipient is the owner of the lock
  if (
    balanceLock.ownerChainId === recipientChainId &&
    balanceLock.ownerAddress === recipientAddress
  ) {
    results = await db.manyOrNone(
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
            available_amount = balances.available_amount + x.amount,
            locked_amount = balances.locked_amount - x.amount,
            updated_at = now()
          FROM x
          WHERE balances.owner_chain_id = x.owner_chain_id
            AND balances.owner_address = x.owner_address
            AND balances.currency_chain_id = x.currency_chain_id
            AND balances.currency_address = x.currency_address
          RETURNING
            x.owner_chain_id,
            x.owner_address,
            x.currency_chain_id,
            x.currency_address,
            x.amount
      `,
      {
        balanceLockId,
      }
    );
  } else {
    results = await db.manyOrNone(
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
          ),
          y AS (
            UPDATE balances SET
              locked_amount = balances.locked_amount - x.amount,
              updated_at = now()
            FROM x
            WHERE balances.owner_chain_id = x.owner_chain_id
              AND balances.owner_address = x.owner_address
              AND balances.currency_chain_id = x.currency_chain_id
              AND balances.currency_address = x.currency_address
            RETURNING
              x.owner_chain_id,
              x.owner_address,
              x.currency_chain_id,
              x.currency_address,
              x.amount
          ),
          z AS (
            INSERT INTO balances (
              owner_chain_id,
              owner_address,
              currency_chain_id,
              currency_address,
              available_amount
            ) (
              SELECT
                $/recipientChainId/,
                $/recipientAddress/,
                x.currency_chain_id,
                x.currency_address,
                x.amount
              FROM x
            )
            ON CONFLICT (owner_chain_id, owner_address, currency_chain_id, currency_address)
            DO UPDATE SET
              available_amount = balances.available_amount + EXCLUDED.available_amount,
              updated_at = now()
            RETURNING
              balances.owner_chain_id,
              balances.owner_address,
              balances.currency_chain_id,
              balances.currency_address
          )
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
        WHERE (
          balances.owner_chain_id,
          balances.owner_address,
          balances.currency_chain_id,
          balances.currency_address
        ) IN
          (
            SELECT y.owner_chain_id, y.owner_address, y.currency_chain_id, y.currency_address FROM y
            UNION ALL
            SELECT z.owner_chain_id, z.owner_address, z.currency_chain_id, z.currency_address FROM z
          )
      `,
      {
        balanceLockId,
        recipientChainId,
        recipientAddress,
      }
    );
  }

  return results.map((r) => ({
    ownerChainId: r.owner_chain_id,
    ownerAddress: r.owner_address,
    currencyChainId: r.currency_chain_id,
    currencyAddress: r.currency_address,
    availableAmount: r.available_amount,
    lockedAmount: r.locked_amount,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }));
};
