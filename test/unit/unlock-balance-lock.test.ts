import { describe, expect, it } from "@jest/globals";

import {
  saveTransactionEntryWithBalanceUpdate,
  TransactionEntry,
} from "../../src/models/transaction-entries";
import {
  BalanceLock,
  getBalance,
  saveBalanceLock,
  unlockBalanceLock,
} from "../../src/models/balances";

import { chains } from "../common/chains";
import { fillArray, iter, randomHex, randomNumber } from "../common/utils";

describe("unlock-balance-lock", () => {
  it("random runs", async () => {
    const chainId = chains[randomNumber(chains.length)].id;

    const ownerChainId = chainId;
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
    const initInMemoryBalanceIfMissing = (key: string) => {
      if (!inMemoryBalances[key]) {
        inMemoryBalances[key] = {
          availableAmount: 0,
          lockedAmount: 0,
        };
      }
    };
    await iter(500, async () => {
      const ownerAddress = ownerAddresses[randomNumber(ownerAddresses.length)];
      const currencyAddress =
        currencyAddresses[randomNumber(currencyAddresses.length)];
      const balanceDiff = randomNumber(1e10);

      const key = `${chainId}-${ownerAddress}-${currencyAddress}`;
      initInMemoryBalanceIfMissing(key);
      inMemoryBalances[key].availableAmount += balanceDiff;

      const transactionEntry: TransactionEntry = {
        chainId,
        transactionId: randomHex(32),
        entryId: "0",
        ownerChainId,
        ownerAddress,
        currencyAddress,
        balanceDiff: balanceDiff.toString(),
      };
      await saveTransactionEntryWithBalanceUpdate(transactionEntry);
    });

    // Lock balances both in the database and in-memory
    const inMemoryBalanceLocks: Record<
      string,
      {
        ownerKey: string;
        chainId: number;
        currencyAddress: string;
        amount: number;
      }
    > = {};
    await Promise.all(
      Object.keys(inMemoryBalances).map(async (key) => {
        const [chainId, ownerAddress, currencyAddress] = key.split("-");

        await iter(randomNumber(5), async () => {
          const lockAmount = Math.floor(
            inMemoryBalances[key].availableAmount / (2 + randomNumber(3))
          );
          inMemoryBalances[key].availableAmount -= lockAmount;
          inMemoryBalances[key].lockedAmount += lockAmount;

          const lockId = randomHex(32);
          inMemoryBalanceLocks[lockId] = {
            ownerKey: key,
            chainId: Number(chainId),
            currencyAddress,
            amount: lockAmount,
          };

          const balanceLock: BalanceLock = {
            id: lockId,
            ownerChainId: Number(chainId),
            ownerAddress: ownerAddress,
            currencyChainId: Number(chainId),
            currencyAddress,
            amount: lockAmount.toString(),
          };
          await saveBalanceLock(balanceLock);
        });
      })
    );

    // Unlock balances both in the database and in-memory
    await Promise.all(
      Object.keys(inMemoryBalanceLocks).map(async (balanceLockId) => {
        const balanceLock = inMemoryBalanceLocks[balanceLockId];

        inMemoryBalances[balanceLock.ownerKey].lockedAmount -=
          balanceLock.amount;

        const recipientAddress =
          ownerAddresses[randomNumber(ownerAddresses.length)];
        const recipientKey = `${balanceLock.chainId}-${recipientAddress}-${balanceLock.currencyAddress}`;
        initInMemoryBalanceIfMissing(recipientKey);
        inMemoryBalances[recipientKey].availableAmount += balanceLock.amount;

        // The unlock method should be idempotent
        await iter(1 + randomNumber(3), () =>
          unlockBalanceLock(balanceLockId, chainId, recipientAddress)
        );
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
