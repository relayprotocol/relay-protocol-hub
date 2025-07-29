import { TypeBoxTypeProvider } from "@fastify/type-provider-typebox";
import Fastify from "fastify";

import { setupEndpoints } from "./api";
import { logger } from "./common/logger";
import { config } from "./config";

const COMPONENT = "http-server";

const httpServer = Fastify().withTypeProvider<TypeBoxTypeProvider>();

// Setup authentication
httpServer.addHook("preHandler", (req, reply, done) => {
  if (config.apiKeys) {
    const apiKey = req.headers["x-api-key"] as string | undefined;
    if (!apiKey || !config.apiKeys[apiKey]) {
      return reply.code(401).send({ error: "Unauthorized" });
    }
  }

  return done();
});

setupEndpoints(httpServer);

httpServer.listen(
  {
    host: "0.0.0.0",
    port: config.httpPort,
  },
  (error) => {
    if (error) {
      logger.error(
        COMPONENT,
        JSON.stringify({
          msg: `Failed to start http server: ${error}`,
          stack: error?.stack,
        })
      );
      process.exit(1);
    }

    logger.info(COMPONENT, JSON.stringify({ msg: "Http server started" }));
  }
);
