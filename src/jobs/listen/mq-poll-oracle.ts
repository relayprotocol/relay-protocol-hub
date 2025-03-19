import axios from "axios";

import { getChain } from "../../common/chains";
import { setupQueue } from "../../common/mq";
import { config } from "../../config";
import {
  getTransactionEntry,
  saveTransactionEntryWithBalanceUpdate,
  TransactionEntry,
} from "../../models/transaction-entries";
import { saveBalanceLock } from "../../models/balances";

const COMPONENT = "mq-poll-oracle";

type Data = {
  continuation?: string;
};

const handler = async (data: Data) => {
  const { continuation } = data;

  const response = await axios
    .get(
      `${config.oracleHttpUrl}/transaction-entries/v1` +
        (continuation ? `?continuation=${continuation}` : "")
    )
    .then((response) => response.data);

  let hasAlreadyProcessedEntries = false;
  await Promise.all(
    response.entries.map(async (entry: any) => {
      // Ensure the entry references a known chain and escrow
      const chain = await getChain(entry.chainId);
      if (!chain || chain.metadata.escrow !== entry.escrow) {
        return;
      }

      let te: TransactionEntry | undefined;

      let depositId: string | undefined;
      if (entry.data.type === "deposit") {
        te = {
          chainId: entry.chainId,
          transactionId: entry.transactionId,
          entryId: entry.entryId,
          ownerAddress: entry.data.data.depositorAddress,
          currencyAddress: entry.data.data.currencyAddress,
          balanceDiff: entry.data.data.amount,
        };

        depositId = entry.data.data.depositId;
      } else {
        // TODO: First fetch the withdrawal by id in order to get the relevant depositor, then construct `te`
      }

      // Ensure we stop once we see an entry we already processed
      if (
        await getTransactionEntry(
          entry.chainId,
          entry.transactionId,
          entry.entryId
        )
      ) {
        hasAlreadyProcessedEntries = true;
      }

      if (te) {
        await saveTransactionEntryWithBalanceUpdate(te);

        if (depositId) {
          await saveBalanceLock({
            id: depositId,
            ownerChainId: te.chainId,
            ownerAddress: te.ownerAddress,
            currencyChainId: te.chainId,
            currencyAddress: te.currencyAddress,
            amount: te.balanceDiff,
          });
        }
      }
    })
  );

  // Put a new job on the queue with the next continuation
  if (!hasAlreadyProcessedEntries && response.continuation) {
    await send({ continuation: response.continuation });
  }
};

const { send } = setupQueue(COMPONENT, handler);

export { send };
