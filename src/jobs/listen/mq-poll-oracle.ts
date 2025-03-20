import axios from "axios";

import { setupQueue } from "../../common/mq";
import { config } from "../../config";
import { mqProcessOracleEntry } from "../../jobs/index";
import { getTransactionEntry } from "../../models/transaction-entries";

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
    .then(
      (response) =>
        response.data as {
          entries: {
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
                    withdrawalId: string;
                  };
                };
          }[];
          continuation?: string;
        }
    );

  let includesAlreadyProcessedEntry = false;
  await Promise.all(
    response.entries.map(async (entry) => {
      // Keep track of whether we already processed this entry
      if (
        await getTransactionEntry(
          entry.chainId,
          entry.transactionId,
          entry.entryId
        )
      ) {
        includesAlreadyProcessedEntry = true;
      }

      await mqProcessOracleEntry.send(entry);
    })
  );

  // Put a new job on the queue with the next continuation
  if (!includesAlreadyProcessedEntry && response.continuation) {
    await send({ continuation: response.continuation });
  }
};

const { send } = setupQueue(COMPONENT, handler);

export { send };
