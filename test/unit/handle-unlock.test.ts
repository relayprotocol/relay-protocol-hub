import { describe, expect, it } from "@jest/globals";

import {
  BalanceLock,
  getBalance,
  saveBalanceLock,
} from "../../src/models/balances";
import { RequestHandlerService } from "../../src/services/request-handler";

import { chains } from "../common/chains";
import {
  fillArray,
  iter,
  ONE_BILLION,
  randomHex,
  randomNumber,
} from "../common/utils";
import {
  OnchainEntry,
  saveOnchainEntryWithBalanceUpdate,
} from "../../src/models/onchain-entries";

describe("handle-unlock", () => {
  it("random runs", async () => {
    const chain = chains[randomNumber(chains.length)];

    const owneres = fillArray(10, () => randomHex(20));
    const currencyes = fillArray(10, () => randomHex(20));

    // Save updates to both the database and in-memory
    const inMemoryBalances: Record<
      string,
      {
        availableAmount: number;
        lockedAmount: number;
      }
    > = {};
    await iter(100, async () => {
      const onchainEntry: OnchainEntry = {
        id: randomHex(32),
        chainId: chain.id,
        transactionId: randomHex(32),
        owner: owneres[randomNumber(owneres.length)],
        currency: currencyes[randomNumber(currencyes.length)],
        balanceDiff: randomNumber(ONE_BILLION).toString(),
      };
      expect(
        await saveOnchainEntryWithBalanceUpdate(onchainEntry)
      ).toBeTruthy();

      const balanceLock: BalanceLock = {
        id: randomHex(32),
        source: randomNumber(10) % 2 === 0 ? "deposit" : "withdrawal",
        ownerChainId: onchainEntry.chainId,
        owner: onchainEntry.owner,
        currencyChainId: onchainEntry.chainId,
        currency: onchainEntry.currency,
        amount: onchainEntry.balanceDiff,
        expiration: randomNumber(ONE_BILLION),
      };
      expect(await saveBalanceLock(balanceLock)).toBeTruthy();

      // Update in-memory balances
      {
        const key = `${onchainEntry.chainId}-${onchainEntry.owner}-${onchainEntry.currency}`;
        if (!inMemoryBalances[key]) {
          inMemoryBalances[key] = {
            availableAmount: 0,
            lockedAmount: 0,
          };
        }
        inMemoryBalances[key].lockedAmount += Number(onchainEntry.balanceDiff);
      }

      const requestHandler = new RequestHandlerService();
      const unlockPromise = requestHandler.handleUnlock({ id: balanceLock.id });
      if (balanceLock.source === "deposit") {
        await expect(unlockPromise).resolves.not.toThrowError();

        // Update in-memory balances
        {
          const key = `${onchainEntry.chainId}-${onchainEntry.owner}-${onchainEntry.currency}`;
          if (!inMemoryBalances[key]) {
            inMemoryBalances[key] = {
              availableAmount: 0,
              lockedAmount: 0,
            };
          }
          inMemoryBalances[key].availableAmount += Number(
            onchainEntry.balanceDiff
          );
          inMemoryBalances[key].lockedAmount -= Number(
            onchainEntry.balanceDiff
          );
        }
      } else {
        await expect(unlockPromise).rejects.toThrowError();
      }
    });

    // Ensure database balances match in-memory balances
    await Promise.all(
      Object.keys(inMemoryBalances).map(async (key) => {
        const [chainId, owner, currency] = key.split("-");

        const dbBalance = await getBalance(chainId, owner, chainId, currency);
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
