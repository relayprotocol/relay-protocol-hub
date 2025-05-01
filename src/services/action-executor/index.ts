import {
  EscrowDepositMessage,
  EscrowWithdrawalMessage,
  EscrowWithdrawalStatus,
  SolverFillMessage,
  SolverFillStatus,
  SolverRefundMessage,
  SolverRefundStatus,
} from "@reservoir0x/relay-protocol-sdk";
import { zeroHash } from "viem";

import { db } from "../../common/db";
import { externalError } from "../../common/error";
import {
  Balance,
  getBalanceLock,
  initializeBalance,
  reallocateBalance,
  saveBalanceLock,
  unlockBalanceLock,
} from "../../models/balances";
import { saveOnchainEntryWithBalanceUpdate } from "../../models/onchain-entries";

export class ActionExecutorService {
  public async executeEscrowDeposit(
    message: EscrowDepositMessage
  ): Promise<void> {
    // Very important to guarantee atomic execution
    await db.tx(async (tx) => {
      // Step 1:
      // Save the deposit
      const saveResult = await saveOnchainEntryWithBalanceUpdate(
        {
          id: message.result.onchainId,
          chainId: message.data.chainId,
          transactionId: message.data.transactionId,
          ownerAddress: message.result.depositor,
          currencyAddress: message.result.currency,
          balanceDiff: message.result.amount,
        },
        { tx }
      );
      // Verify the save result
      if (!saveResult) {
        return;
      }

      if (message.result.depositId !== zeroHash) {
        // Step 2:
        // Lock the balance
        const lockResult = await saveBalanceLock(
          {
            id: message.result.onchainId,
            ownerChainId: message.data.chainId,
            ownerAddress: message.result.depositor,
            currencyChainId: message.data.chainId,
            currencyAddress: message.result.currency,
            amount: message.result.amount,
          },
          { tx }
        );
        // Verify the lock result
        if (!lockResult) {
          return;
        }
      }
    });
  }

  public async executeEscrowWithdrawal(
    message: EscrowWithdrawalMessage
  ): Promise<void> {
    if (message.result.status !== EscrowWithdrawalStatus.EXECUTED) {
      throw externalError("Escrow withdrawal is not executed");
    }

    // Very important to guarantee atomic execution
    await db.tx(async (tx) => {
      // Step 1:
      // Unlock and reduce the balance
      const unlockResult = await (async () => {
        const balanceLock = await getBalanceLock(message.result.withdrawalId, {
          tx,
        });
        const newBalance = await unlockBalanceLock(
          message.result.withdrawalId,
          { tx, skipAvailableBalanceAdjustment: true }
        );
        return { balanceLock, newBalance };
      })();
      // Verify the unlock result
      if (!unlockResult.balanceLock || !unlockResult.newBalance) {
        throw externalError("Corresponding balance lock already unlocked");
      }
    });
  }

  public async executeSolverFill(message: SolverFillMessage): Promise<void> {
    if (message.result.status !== SolverFillStatus.SUCCESSFUL) {
      throw externalError("Solver fill is not successful");
    }

    // Very important to guarantee atomic execution
    await db.tx(async (tx) => {
      // Step 1:
      // Unlock all relevant balance locks
      const unlockResult = await Promise.all(
        message.data.inputs.map(async ({ onchainId }) => {
          const balanceLock = await getBalanceLock(onchainId, { tx });
          const newBalance = await unlockBalanceLock(onchainId, { tx });
          return { balanceLock, newBalance };
        })
      );
      // Verify the unlock result
      if (unlockResult.some((r) => !r.balanceLock || !r.newBalance)) {
        throw externalError("Corresponding balance lock(s) already unlocked");
      }

      // Step 2:
      // Reallocate the payments to the solver
      const reallocatePaymentsResult = await Promise.all(
        unlockResult
          .map((d) => d.balanceLock!)
          .map(async (balanceLock) => {
            // Ensure the solver's balance is initialized before reallocating
            await initializeBalance(
              message.data.order.solverChainId,
              message.data.order.solver,
              balanceLock.currencyChainId,
              balanceLock.currencyAddress,
              { tx }
            );

            const newBalances = await reallocateBalance(
              {
                ownerChainId: balanceLock.ownerChainId,
                ownerAddress: balanceLock.ownerAddress,
                currencyChainId: balanceLock.currencyChainId,
                currencyAddress: balanceLock.currencyAddress,
              },
              {
                ownerChainId: message.data.order.solverChainId,
                ownerAddress: message.data.order.solver,
              },
              balanceLock.amount,
              { tx }
            );

            return { balanceLock, newBalances };
          })
      );
      // Verify the reallocation result
      if (
        !reallocatePaymentsResult.every((r) =>
          this._verifyReallocationResult(
            r.newBalances,
            r.balanceLock.ownerChainId,
            r.balanceLock.ownerAddress,
            message.data.order.solverChainId,
            message.data.order.solver
          )
        )
      ) {
        throw externalError("Payment balance reallocation failed");
      }

      // Step 3:
      // Reallocate the fees to the recipients
      const reallocateFeesResult = await Promise.all(
        message.data.order.fees.map(async (fee) => {
          // Ensure the recipient's balance is initialized before reallocating
          await initializeBalance(
            fee.recipientChainId,
            fee.recipient,
            fee.currencyChainId,
            fee.currency,
            { tx }
          );

          const newBalances = await reallocateBalance(
            {
              ownerChainId: message.data.order.solverChainId,
              ownerAddress: message.data.order.solver,
              currencyChainId: fee.currencyChainId,
              currencyAddress: fee.currency,
            },
            {
              ownerChainId: fee.recipientChainId,
              ownerAddress: fee.recipient,
            },
            String(
              BigInt(fee.amount) +
                (BigInt(fee.amount) *
                  BigInt(message.result.totalWeightedInputPaymentBpsDiff)) /
                  10n ** 18n
            ),
            { tx }
          );

          return { fee, newBalances };
        })
      );
      // Verify the reallocation result
      if (
        !reallocateFeesResult.every((r) =>
          this._verifyReallocationResult(
            r.newBalances,
            message.data.order.solverChainId,
            message.data.order.solver,
            r.fee.recipientChainId,
            r.fee.recipient
          )
        )
      ) {
        throw externalError("Fee balance reallocation failed");
      }
    });
  }

  public async executeSolverRefund(
    message: SolverRefundMessage
  ): Promise<void> {
    if (message.result.status !== SolverRefundStatus.SUCCESSFUL) {
      throw externalError("Solver refund is not successful");
    }

    // Very important to guarantee atomic execution
    await db.tx(async (tx) => {
      // Step 1:
      // Unlock all relevant balance locks
      const unlockResult = await Promise.all(
        message.data.inputs.map(async ({ onchainId }) => {
          const balanceLock = await getBalanceLock(onchainId, { tx });
          const newBalance = await unlockBalanceLock(onchainId, { tx });
          return { balanceLock, newBalance };
        })
      );
      // Verify the unlock result
      if (unlockResult.some((r) => !r.balanceLock || !r.newBalance)) {
        throw externalError("Corresponding balance lock(s) already unlocked");
      }

      // Step 2:
      // Reallocate the payments to the solver
      const reallocatePaymentsResult = await Promise.all(
        unlockResult
          .map((d) => d.balanceLock!)
          .map(async (balanceLock) => {
            // Ensure the solver's balance is initialized before reallocating
            await initializeBalance(
              message.data.order.solverChainId,
              message.data.order.solver,
              balanceLock.currencyChainId,
              balanceLock.currencyAddress,
              { tx }
            );

            const newBalances = await reallocateBalance(
              {
                ownerChainId: balanceLock.ownerChainId,
                ownerAddress: balanceLock.ownerAddress,
                currencyChainId: balanceLock.currencyChainId,
                currencyAddress: balanceLock.currencyAddress,
              },
              {
                ownerChainId: message.data.order.solverChainId,
                ownerAddress: message.data.order.solver,
              },
              balanceLock.amount,
              { tx }
            );

            return { balanceLock, newBalances };
          })
      );
      // Verify the reallocation result
      if (
        !reallocatePaymentsResult.every((r) =>
          this._verifyReallocationResult(
            r.newBalances,
            r.balanceLock.ownerChainId,
            r.balanceLock.ownerAddress,
            message.data.order.solverChainId,
            message.data.order.solver
          )
        )
      ) {
        throw externalError("Payment balance reallocation failed");
      }
    });
  }

  // Get a unique id for a chain / address combination
  private _getId(chainId: number, address: string) {
    return `${chainId}:${address}`.toLowerCase();
  }

  // Utility for verifying the result of a reallocation
  private _verifyReallocationResult(
    newBalances: Balance[],
    fromChainId: number,
    fromAddress: string,
    toChainId: number,
    toAddress: string
  ) {
    const fromId = this._getId(fromChainId, fromAddress);
    const toId = this._getId(toChainId, toAddress);

    // Ensure that the reallocation resulted in balance changes for the `from` and `to` wallets
    return [fromId, toId].every((id) =>
      newBalances.find(
        (b) => this._getId(b.ownerChainId, b.ownerAddress) === id
      )
    );
  }
}
