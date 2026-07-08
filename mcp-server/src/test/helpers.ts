/**
 * Test helper: connect an MCP Client to a freshly-built SyncNo MCP server over
 * an in-memory transport pair, and return the (initialized) client so tests can
 * call tools/list and tools/call without a network or a live backend.
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { registerAllTools } from '../registry.js';

export async function connectTestClient(): Promise<Client> {
  const server = new McpServer({ name: 'syncno-mcp-test', version: '0.0.0' });
  registerAllTools(server);

  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test-client', version: '0.0.0' });

  // Connect the SERVER first so it's ready to answer the client's initialize
  // handshake. (Both sides call start(), which for the in-memory transport is
  // a no-op that just drains any buffered messages — order matters because
  // Client.connect awaits the initialize response.)
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  return client;
}
