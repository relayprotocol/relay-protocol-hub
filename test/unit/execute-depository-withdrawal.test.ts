import { describe, expect, it, jest } from "@jest/globals";
import {
  DepositoryDepositMessage,
  DepositoryWithdrawalMessage,
  DepositoryWithdrawalStatus,
} from "@relay-protocol/settlement-sdk";
import { zeroHash } from "viem";

import { getBalance } from "../../src/models/balances";
import { ActionExecutorService } from "../../src/services/action-executor";
import { RequestHandlerService } from "../../src/services/request-handler";

import { chains } from "../common/chains";
import {
  fillArray,
  iter,
  ONE_BILLION,
  randomHex,
  randomNumber,
} from "../common/utils";

jest.mock("../../src/config", () => {
  return {
    config: {
      ...(
        jest.requireActual(
          "../../src/config"
        ) as typeof import("../../src/config")
      ).config,
      ecdsaPrivateKey:
        "0x0000000000000000000000000000000000000000000000000000000000000001",
    },
  };
});

describe("execute-depository-withdrawal", () => {
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
    await iter(250, async () => {
      const depositMessage: DepositoryDepositMessage = {
        data: {
          chainId: chain.id,
          transactionId: randomHex(32),
        },
        result: {
          onchainId: randomHex(32),
          depository: chain.depository!,
          depositId: zeroHash,
          depositor: owneres[randomNumber(owneres.length)],
          currency: currencyes[randomNumber(currencyes.length)],
          amount: randomNumber(ONE_BILLION).toString(),
        },
      };

      const actionExecutor = new ActionExecutorService();
      await expect(
        actionExecutor.executeDepositoryDeposit(depositMessage)
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

      const amount = (
        1 + randomNumber(Number(depositMessage.result.amount) / 2)
      ).toString();

      const requestHandler = new RequestHandlerService();
      const withdrawalResult = await requestHandler.handleWithdrawal({
        ownerChainId: chain.id,
        owner: depositMessage.result.depositor,
        chainId: chain.id,
        currency: depositMessage.result.currency,
        amount,
        recipient: depositMessage.result.depositor,
      });

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

      const withdrawalMessage: DepositoryWithdrawalMessage = {
        data: {
          chainId: chain.id,
          withdrawal: withdrawalResult.encodedData,
        },
        result: {
          withdrawalId: withdrawalResult.id,
          depository: chain.depository!,
          status: DepositoryWithdrawalStatus.EXECUTED,
        },
      };

      await expect(
        actionExecutor.executeDepositoryWithdrawal(withdrawalMessage)
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
