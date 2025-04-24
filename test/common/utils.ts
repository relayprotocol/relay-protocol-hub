import { randomBytes } from "crypto";

export const fillArray = <T>(count: number, fn: () => T) =>
  [...new Array(count)].map(fn);

export const iter = <T>(count: number, fn: () => Promise<T>) =>
  Promise.all(fillArray(count, () => 0).map(fn));

export const randomHex = (size: number) =>
  "0x" + randomBytes(size).toString("hex");

export const randomNumber = (max: number) =>
  Number(BigInt(randomHex(5)).toString()) % max;

export const wait = async (ms: number) =>
  new Promise((resolve) => setTimeout(resolve, ms));
