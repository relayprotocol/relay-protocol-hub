import { describe, expect, it } from "@jest/globals";

import {
  BalanceLock,
  getBalance,
  saveBalanceLock,
} from "../../src/models/balances";
import {
  saveOnchainEntryWithBalanceUpdate,
  OnchainEntry,
} from "../../src/models/onchain-entries";

import { chains } from "../common/chains";
import {
  fillArray,
  iter,
  ONE_BILLION,
  randomHex,
  randomNumber,
} from "../common/utils";

describe("save-balance-lock", () => {
  it("random runs", async () => {
    const chainId = chains[randomNumber(chains.length)].id;

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
    await iter(250, async () => {
      const ownerAddress = ownerAddresses[randomNumber(ownerAddresses.length)];
      const currencyAddress =
        currencyAddresses[randomNumber(currencyAddresses.length)];
      const balanceDiff = randomNumber(ONE_BILLION);

      // Update in-memory balances
      {
        const key = `${chainId}-${ownerAddress}-${currencyAddress}`;
        if (!inMemoryBalances[key]) {
          inMemoryBalances[key] = {
            availableAmount: 0,
            lockedAmount: 0,
          };
        }
        inMemoryBalances[key].availableAmount += balanceDiff;
      }

      const onchainEntry: OnchainEntry = {
        id: randomHex(32),
        chainId,
        transactionId: randomHex(32),
        ownerAddress,
        currencyAddress,
        balanceDiff: balanceDiff.toString(),
      };
      await saveOnchainEntryWithBalanceUpdate(onchainEntry);
    });

    // Lock balances both in the database and in-memory
    await Promise.all(
      Object.keys(inMemoryBalances).map(async (key) => {
        const [chainId, ownerAddress, currencyAddress] = key.split("-");

        await iter(randomNumber(5), async () => {
          const lockedAmount = Math.floor(
            inMemoryBalances[key].availableAmount / (1 + randomNumber(3))
          );

          // Update in-memory balances
          {
            inMemoryBalances[key].availableAmount -= lockedAmount;
            inMemoryBalances[key].lockedAmount += lockedAmount;
          }

          const balanceLock: BalanceLock = {
            id: randomHex(32),
            ownerChainId: chainId,
            ownerAddress: ownerAddress,
            currencyChainId: chainId,
            currencyAddress,
            amount: lockedAmount.toString(),
          };

          // The save method should be idempotent
          await iter(1 + randomNumber(3), () => saveBalanceLock(balanceLock));
        });
      })
    );

    // Ensure database balances match in-memory balances
    await Promise.all(
      Object.keys(inMemoryBalances).map(async (key) => {
        const [chainId, ownerAddress, currencyAddress] = key.split("-");

        const dbBalance = await getBalance(
          chainId,
          ownerAddress,
          chainId,
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
