import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerWorkbookTools } from "./tools.js";

export const serverName = "spreadbreadai-mcp-server";
export const serverVersion = "0.1.0";

export function createServer() {
  const server = new McpServer({
    name: serverName,
    version: serverVersion,
  });

  registerWorkbookTools(server);
  return server;
}
