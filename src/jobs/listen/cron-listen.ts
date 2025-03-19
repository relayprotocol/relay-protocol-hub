import cron from "node-cron";

import { logger } from "../../common/logger";
import { mqPollOracle } from "../../jobs";

const COMPONENT = "cron-listen-oracle";

// Every few seconds, poll the oracle for new transaction entries
cron.schedule("*/5 * * * * *", async () => {
  try {
    await mqPollOracle.send({});
  } catch (error) {
    logger.error(
      COMPONENT,
      JSON.stringify({
        msg: "Error polling for new transaction entries",
        error,
        stack: (error as any).stack,
      })
    );
  }
});
