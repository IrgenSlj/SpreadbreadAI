import { createServer, serverName, serverVersion } from "./server.js";
import { toolNames } from "./tools.js";

createServer();

console.log(
  JSON.stringify(
    {
      status: "ok",
      name: serverName,
      version: serverVersion,
      tools: Object.values(toolNames),
    },
    null,
    2
  )
);
