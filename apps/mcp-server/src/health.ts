import { createServer, serverName, serverVersion } from "./server.js";
import { getStoreRuntimeStatus } from "./store.js";
import { toolNames } from "./tools.js";
import { listStoredWorkbooks } from "./store.js";

async function main() {
  createServer();
  const workbooks = await listStoredWorkbooks();
  const runtime = await getStoreRuntimeStatus();

  console.log(
    JSON.stringify(
      {
        status: "ok",
        name: serverName,
        version: serverVersion,
        runtime,
        tools: Object.values(toolNames),
        demoWorkbooks: workbooks.map((workbook) => workbook.id),
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error("[health] fatal error", error);
  process.exitCode = 1;
});
