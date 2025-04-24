const net = require("net");

const waitForService = (host, port, timeout = 10000) => {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Timeout waiting for ${host}:${port}`));
    }, timeout);

    const tryConnect = () => {
      const socket = new net.Socket();
      socket.connect(port, host, () => {
        clearTimeout(timer);
        socket.destroy();
        resolve();
      });
      socket.on("error", () => {
        socket.destroy();
        setTimeout(tryConnect, 1000);
      });
    };

    tryConnect();
  });
};

const main = async () => {
  try {
    await waitForService("localhost", 5432); // Wait for PostgreSQL
    console.log("All services are ready");
    process.exit(0);
  } catch (error) {
    console.error("Error waiting for services:", error);
    process.exit(1);
  }
};

main();
