import { getChain } from "../../common/chains";
import { db } from "../../common/db";
import { setupQueue } from "../../common/mq";
import { saveBalanceLock, unlockBalanceLock } from "../../models/balances";
import {
  saveTransactionEntryWithBalanceUpdate,
  TransactionEntry,
} from "../../models/transaction-entries";
import { getWithdrawalRequest } from "../../models/withdrawal-requests";

const COMPONENT = "mq-process-oracle-entry";

type Data = {
  chainId: number;
  transactionId: string;
  entryId: string;
  escrow: string;
  data:
    | {
        type: "deposit";
        data: {
          depositorAddress: string;
          currencyAddress: string;
          amount: string;
          depositId?: string;
        };
      }
    | {
        type: "withdrawal";
        data: {
          currencyAddress: string;
          amount: string;
          withdrawalId?: string;
        };
      };
};

const handler = async (data: Data) => {
  const { chainId, transactionId, entryId, escrow, data: entryData } = data;

  // Ensure the entry references a known chain and escrow
  const chain = await getChain(chainId);
  if (!chain || chain.metadata.escrow !== escrow) {
    return;
  }

  let transactionEntry: TransactionEntry | undefined;

  let depositId: string | undefined;
  let withdrawalId: string | undefined;
  if (entryData.type === "deposit") {
    transactionEntry = {
      chainId,
      transactionId,
      entryId,
      ownerChainId: chainId,
      ownerAddress: entryData.data.depositorAddress,
      currencyAddress: entryData.data.currencyAddress,
      balanceDiff: entryData.data.amount,
    };

    depositId = entryData.data.depositId;
  } else {
    withdrawalId = entryData.data.withdrawalId;

    const withdrawalRequest = await getWithdrawalRequest(withdrawalId!);
    if (!withdrawalRequest) {
      throw new Error("Withdrawal not found - should never happen");
    }

    if (
      chainId !== withdrawalRequest.chainId ||
      entryData.data.currencyAddress !== withdrawalRequest.currencyAddress ||
      entryData.data.amount !== withdrawalRequest.amount
    ) {
      throw new Error(
        "Withdrawal data does not match entry data - should never happen"
      );
    }

    transactionEntry = {
      chainId,
      transactionId,
      entryId,
      ownerChainId: withdrawalRequest.ownerChainId,
      ownerAddress: withdrawalRequest.ownerAddress,
      currencyAddress: withdrawalRequest.currencyAddress,
      balanceDiff: "-" + withdrawalRequest.amount,
    };
  }

  if (depositId) {
    // It's very important to use a transaction for saving the transaction entry and balance lock
    await db.tx(async (tx) => {
      const newBalance = await saveTransactionEntryWithBalanceUpdate(
        transactionEntry,
        tx
      );
      if (!newBalance) {
        throw new Error("Failed to save transaction entry");
      }

      const balanceLock = await saveBalanceLock(
        {
          id: depositId,
          ownerChainId: transactionEntry.ownerChainId,
          ownerAddress: transactionEntry.ownerAddress,
          currencyChainId: transactionEntry.chainId,
          currencyAddress: transactionEntry.currencyAddress,
          amount: transactionEntry.balanceDiff,
        },
        tx
      );
      if (!balanceLock) {
        throw new Error("Failed to save balance lock");
      }
    });
  }

  if (withdrawalId) {
    // It's very important to use a transaction for unlocking the balance and saving the transaction entry
    await db.tx(async (tx) => {
      const newBalances = await unlockBalanceLock(
        withdrawalId,
        transactionEntry.ownerChainId,
        transactionEntry.ownerAddress,
        tx
      );
      if (!newBalances.length) {
        throw new Error("Failed to unlock balance");
      }

      const newBalance = await saveTransactionEntryWithBalanceUpdate(
        transactionEntry,
        tx
      );
      if (!newBalance) {
        throw new Error("Failed to save transaction entry");
      }
    });
  }
};

const { send } = setupQueue(COMPONENT, handler);

export { send };
