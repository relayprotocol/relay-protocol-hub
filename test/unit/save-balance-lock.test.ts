import { describe, expect, it } from "@jest/globals";

import {
  saveTransactionEntryWithBalanceUpdate,
  TransactionEntry,
} from "../../src/models/transaction-entries";
import {
  BalanceLock,
  getBalance,
  saveBalanceLock,
} from "../../src/models/balances";

import { fillArray, iter, randomHex, randomNumber } from "../common/utils";

describe("save-balance-lock", () => {
  it("random runs", async () => {
    const chainId = 1;

    const ownerAddresses = fillArray(20, () => randomHex(20));
    const currencyAddresses = fillArray(20, () => randomHex(20));

    // Save transaction entry updates to both the database and in-memory
    const inMemoryBalances: Record<
      string,
      {
        availableAmount: number;
        lockedAmount: number;
      }
    > = {};
    await iter(500, async () => {
      const ownerAddress = ownerAddresses[randomNumber(ownerAddresses.length)];
      const currencyAddress =
        currencyAddresses[randomNumber(currencyAddresses.length)];
      const balanceDiff = randomNumber(1e10);

      const key = `${chainId}-${ownerAddress}-${currencyAddress}`;
      if (!inMemoryBalances[key]) {
        inMemoryBalances[key] = {
          availableAmount: 0,
          lockedAmount: 0,
        };
      }
      inMemoryBalances[key].availableAmount += balanceDiff;

      const transactionEntry: TransactionEntry = {
        chainId,
        transactionId: randomHex(32),
        entryId: "0",
        ownerAddress,
        currencyAddress,
        balanceDiff: balanceDiff.toString(),
      };
      await saveTransactionEntryWithBalanceUpdate(transactionEntry);
    });

    // Lock balances both in the database and in-memory
    await Promise.all(
      Object.keys(inMemoryBalances).map(async (key) => {
        const [chainId, ownerAddress, currencyAddress] = key.split("-");

        await iter(randomNumber(5), async () => {
          const lockedAmount = Math.floor(
            inMemoryBalances[key].availableAmount / (1 + randomNumber(3))
          );
          inMemoryBalances[key].availableAmount -= lockedAmount;
          inMemoryBalances[key].lockedAmount += lockedAmount;

          const balanceLock: BalanceLock = {
            id: randomHex(32),
            ownerChainId: Number(chainId),
            ownerAddress: ownerAddress,
            currencyChainId: Number(chainId),
            currencyAddress,
            amount: lockedAmount.toString(),
          };

          // The save method should be idempotent
          await iter(1 + randomNumber(3), () => saveBalanceLock(balanceLock));
        });
      })
    );

    // Ensure the database balances match the in-memory balances
    await Promise.all(
      Object.keys(inMemoryBalances).map(async (key) => {
        const [chainId, ownerAddress, currencyAddress] = key.split("-");

        const dbBalance = await getBalance(
          Number(chainId),
          ownerAddress,
          Number(chainId),
          currencyAddress
        );
        expect(dbBalance).toBeTruthy();
        expect(
          dbBalance?.availableAmount ===
            inMemoryBalances[key].availableAmount.toString()
        ).toBeTruthy();
        expect(
          dbBalance?.lockedAmount ===
            inMemoryBalances[key].lockedAmount.toString()
        ).toBeTruthy();
      })
    );
  });
});
