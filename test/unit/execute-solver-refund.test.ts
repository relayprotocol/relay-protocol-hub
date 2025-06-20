import { describe, expect, it } from "@jest/globals";
import {
  DepositoryDepositMessage,
  getOrderId,
  Order,
  SolverRefundMessage,
  SolverRefundStatus,
} from "@reservoir0x/relay-protocol-sdk";

import { getBalance } from "../../src/models/balances";
import { ActionExecutorService } from "../../src/services/action-executor";

import { chains } from "../common/chains";
import {
  fillArray,
  iterNoConcurrency,
  now,
  ONE_BILLION,
  randomHex,
  randomNumber,
} from "../common/utils";

describe("execute-solver-refund", () => {
  it("random runs with single input order", async () => {
    const chain = chains[randomNumber(chains.length)];

    const solverAddress = randomHex(20);
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
    await iterNoConcurrency(150, async () => {
      const order: Order = {
        version: "v1",
        solverChainId: chain.id,
        solver: solverAddress,
        salt: randomNumber(ONE_BILLION).toString(),
        inputs: [
          {
            payment: {
              chainId: chain.id,
              currency: currencyes[randomNumber(currencyes.length)],
              amount: randomNumber(ONE_BILLION).toString(),
              weight: "1",
            },
            refunds: [
              {
                chainId: chain.id,
                recipient: owneres[randomNumber(owneres.length)],
                currency: currencyes[randomNumber(currencyes.length)],
                minimumAmount: randomNumber(ONE_BILLION).toString(),
                deadline: now() + 3600,
                extraData: "0x",
              },
            ],
          },
        ],
        output: {
          chainId: chain.id,
          payments: [
            {
              recipient: owneres[randomNumber(owneres.length)],
              currency: currencyes[randomNumber(currencyes.length)],
              expectedAmount: randomNumber(ONE_BILLION).toString(),
              minimumAmount: randomNumber(ONE_BILLION).toString(),
            },
          ],
          calls: [],
          deadline: now() + 3600,
          extraData: "0x",
        },
        fees:
          randomNumber(10) % 2 === 0
            ? []
            : [
                {
                  recipientChainId: chain.id,
                  recipient: owneres[randomNumber(owneres.length)],
                  currencyChainId: chain.id,
                  currency: currencyes[randomNumber(currencyes.length)],
                  amount: randomNumber(ONE_BILLION).toString(),
                },
              ],
      };
      const orderId = getOrderId(order, { [chain.id]: "ethereum-vm" });

      const actionExecutor = new ActionExecutorService();

      const depositoryDepositMessage: DepositoryDepositMessage = {
        data: {
          chainId: chain.id,
          transactionId: randomHex(32),
        },
        result: {
          onchainId: randomHex(32),
          depository: chain.depository!,
          depositId: orderId,
          depositor: owneres[randomNumber(owneres.length)],
          currency: order.inputs[0].payment.currency,
          amount: order.inputs[0].payment.amount,
        },
      };
      await expect(
        actionExecutor.executeDepositoryDeposit(depositoryDepositMessage)
      ).resolves.not.toThrowError();

      // Update in-memory balances
      {
        const key = `${chain.id}-${depositoryDepositMessage.result.depositor}-${depositoryDepositMessage.result.currency}`;
        if (!inMemoryBalances[key]) {
          inMemoryBalances[key] = {
            availableAmount: 0,
            lockedAmount: 0,
          };
        }
        inMemoryBalances[key].lockedAmount += Number(
          depositoryDepositMessage.result.amount
        );
      }

      const solverRefundMessage: SolverRefundMessage = {
        data: {
          order,
          orderSignature: randomHex(64),
          inputs: [
            {
              transactionId: depositoryDepositMessage.data.transactionId,
              onchainId: depositoryDepositMessage.result.onchainId,
              inputIndex: 0,
            },
          ],
          refunds: [
            {
              transactionId: randomHex(32),
              inputIndex: 0,
              refundIndex: 0,
            },
          ],
        },
        result: {
          orderId,
          status: SolverRefundStatus.SUCCESSFUL,
          totalWeightedInputPaymentBpsDiff: "0",
        },
      };
      await expect(
        actionExecutor.executeSolverRefund(solverRefundMessage)
      ).resolves.not.toThrowError();

      // Update in-memory balances
      {
        const key = `${chain.id}-${depositoryDepositMessage.result.depositor}-${depositoryDepositMessage.result.currency}`;
        inMemoryBalances[key].lockedAmount -= Number(
          depositoryDepositMessage.result.amount
        );
      }
      {
        const key = `${chain.id}-${order.solver}-${depositoryDepositMessage.result.currency}`;
        if (!inMemoryBalances[key]) {
          inMemoryBalances[key] = {
            availableAmount: 0,
            lockedAmount: 0,
          };
        }
        inMemoryBalances[key].availableAmount += Number(
          depositoryDepositMessage.result.amount
        );
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
