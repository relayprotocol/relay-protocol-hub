// Add support for serializing BigInt
JSON.stringify = (value: any) =>
  JSON.stringify(value, (_, value) => {
    return typeof value === "bigint" ? value.toString() : value;
  });
