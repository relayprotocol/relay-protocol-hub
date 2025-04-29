import { randomBytes } from "crypto";

export const ONE_BILLION = 1_000_000_000;

export const fillArray = <T>(count: number, fn: () => T) =>
  [...new Array(count)].map(fn);

export const iter = <T>(count: number, fn: () => Promise<T>) =>
  Promise.all(fillArray(count, () => 0).map(fn));

export const iterNoConcurrency = async <T>(
  count: number,
  fn: () => Promise<T>
) => {
  let results: T[] = [];
  for (let i = 0; i < count; i++) {
    results.push(await fn());
  }
  return results;
};

export const randomHex = (size: number) =>
  "0x" + randomBytes(size).toString("hex");

export const randomNumber = (max: number) =>
  Number(BigInt(randomHex(5)).toString()) % Math.floor(max);

export const wait = async (ms: number) =>
  new Promise((resolve) => setTimeout(resolve, ms));

export const now = () => Math.floor(Date.now() / 1000);
