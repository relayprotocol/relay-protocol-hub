import { describe, expect, it } from "@jest/globals";
import {
  EscrowDepositMessage,
  EscrowWithdrawalMessage,
  EscrowWithdrawalStatus,
} from "@reservoir0x/relay-protocol-sdk";
import { zeroHash } from "viem";

import { getBalance, saveBalanceLock } from "../../src/models/balances";
import { ActionExecutorService } from "../../src/services/action-executor";

import { chains } from "../common/chains";
import {
  fillArray,
  iter,
  ONE_BILLION,
  randomHex,
  randomNumber,
} from "../common/utils";

describe("execute-escrow-withdrawal", () => {
  it("random runs", async () => {
    const chain = chains[randomNumber(chains.length)];

    const ownerAddresses = fillArray(10, () => randomHex(20));
    const currencyAddresses = fillArray(10, () => randomHex(20));

    // Save updates to both the database and in-memory
    const inMemoryBalances: Record<
      string,
      {
        availableAmount: number;
        lockedAmount: number;
      }
    > = {};
    await iter(250, async () => {
      const depositMessage: EscrowDepositMessage = {
        data: {
          chainId: chain.id,
          transactionId: randomHex(32),
        },
        result: {
          onchainId: randomHex(32),
          escrow: chain.escrow,
          depositId: zeroHash,
          depositor: ownerAddresses[randomNumber(ownerAddresses.length)],
          currency: currencyAddresses[randomNumber(currencyAddresses.length)],
          amount: randomNumber(ONE_BILLION).toString(),
        },
      };

      const actionExecutor = new ActionExecutorService();
      await expect(
        actionExecutor.executeEscrowDeposit(depositMessage)
      ).resolves.not.toThrowError();

      // Update in-memory balances
      {
        const key = `${chain.id}-${depositMessage.result.depositor}-${depositMessage.result.currency}`;
        if (!inMemoryBalances[key]) {
          inMemoryBalances[key] = {
            availableAmount: 0,
            lockedAmount: 0,
          };
        }
        inMemoryBalances[key].availableAmount += Number(
          depositMessage.result.amount
        );
      }

      const withdrawalMessage: EscrowWithdrawalMessage = {
        data: {
          chainId: chain.id,
          withdrawal: randomHex(64),
        },
        result: {
          withdrawalId: randomHex(32),
          escrow: chain.escrow,
          status: EscrowWithdrawalStatus.EXECUTED,
        },
      };

      const amount = (
        1 + randomNumber(Number(depositMessage.result.amount) / 2)
      ).toString();
      const saveResult = await saveBalanceLock({
        id: withdrawalMessage.result.withdrawalId,
        ownerChainId: chain.id,
        ownerAddress: depositMessage.result.depositor,
        currencyChainId: chain.id,
        currencyAddress: depositMessage.result.currency,
        amount,
      });
      expect(saveResult).toBeTruthy();

      // Update in-memory balances
      {
        const key = `${chain.id}-${depositMessage.result.depositor}-${depositMessage.result.currency}`;
        if (!inMemoryBalances[key]) {
          inMemoryBalances[key] = {
            availableAmount: 0,
            lockedAmount: 0,
          };
        }
        inMemoryBalances[key].availableAmount -= Number(amount);
        inMemoryBalances[key].lockedAmount += Number(amount);
      }

      await expect(
        actionExecutor.executeEscrowWithdrawal(withdrawalMessage)
      ).resolves.not.toThrowError();

      // Update in-memory balances
      {
        const key = `${chain.id}-${depositMessage.result.depositor}-${depositMessage.result.currency}`;
        if (!inMemoryBalances[key]) {
          inMemoryBalances[key] = {
            availableAmount: 0,
            lockedAmount: 0,
          };
        }
        inMemoryBalances[key].lockedAmount -= Number(amount);
      }
    });

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
        if (
          dbBalance?.availableAmount !==
          inMemoryBalances[key].availableAmount.toString()
        ) {
          console.log(key, inMemoryBalances[key], dbBalance);
        }
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
