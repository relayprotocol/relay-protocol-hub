import { Channel } from "amqplib";
import amqp from "amqp-connection-manager";

import { logger } from "./logger";
import { config } from "../config";

const connection = amqp.connect([config.rabbitUrl]);

export const setupQueue = <T>(
  queue: string,
  handler?: (data: T) => Promise<void>
) => {
  const handlerWrapper = async (data: T): Promise<void> => {
    try {
      await handler?.(data);
    } catch (error: any) {
      logger.error(
        queue,
        JSON.stringify({
          msg: "Job failed",
          error,
          errorMsg: error.msg,
          errorResponse: error.response?.data ?? error.response?.body,
          errorStack: error.stack,
        })
      );

      throw error;
    }
  };

  const cw = connection.createChannel({
    json: true,
    setup: async (channel: Channel) => {
      await channel.assertQueue(queue, { durable: true });
      if (handler) {
        await channel.consume(
          queue,
          async (msg) => {
            if (msg) {
              const parsedMsg = JSON.parse(msg.content.toString()) as T;
              await handlerWrapper(parsedMsg);
              channel.ack(msg);
            }
          },
          { noAck: false }
        );
      }
    },
  });

  return {
    send: async (data: T) => {
      cw.sendToQueue(queue, data, { persistent: true });
    },
  };
};
