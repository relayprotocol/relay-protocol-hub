// Add support for serializing BigInt
const jsonStringify = JSON.stringify;
JSON.stringify = (value: any) =>
  jsonStringify(value, (_, value) => {
    return typeof value === "bigint" ? value.toString() : value;
  });
