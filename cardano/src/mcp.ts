// MCP server for LLM agents: `list_flights` is free, `get_flight_verdict` pays per request on Cardano via x402.
// Add to an MCP client as: { "command": "node", "args": ["--env-file=cardano/.env", "cardano/src/mcp.ts"] }
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { decodePaymentResponseHeader } from '@x402/fetch';
import { z } from 'zod';
import { blockfrost, env, payingFetch, txLink, walletFor } from './cardano.ts';

export const createMcpServer = (server: string, pay: typeof fetch) => {
  const mcp = new McpServer({ name: 'aeroguard-cardano', version: '0.1.0' });
  const text = (value: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }] });

  mcp.registerTool('list_flights', {
    description: 'Free. Flights AeroGuard can prove, with their price in lovelace (status = pre-departure, arrival = final).',
  }, async () => text(await (await fetch(`${server}/flights`)).json()));

  mcp.registerTool('get_flight_verdict', {
    description: 'Paid (tADA on Cardano preprod via x402, capped per request). Returns the flight verdict (status, delay, final) '
      + 'and the AeroDataBox Airnode-signed proof that FlightDelayCover or any AirnodeV2Attestation.verify accepts, plus the Cardano payment tx.',
    inputSchema: { flight: z.string().regex(/^[A-Za-z0-9]{3,10}$/), date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) },
  }, async ({ flight, date }) => {
    const res = await pay(`${server}/verdict?flight=${flight}&date=${date}`);
    const header = res.headers.get('PAYMENT-RESPONSE');
    const receipt = header ? decodePaymentResponseHeader(header) : undefined;
    const body = await res.json().catch(() => undefined);
    if (!res.ok) return { ...text({ error: `HTTP ${res.status}`, body, receipt }), isError: true };
    return text({ ...body, receipt: receipt && { ...receipt, explorer: txLink(receipt.transaction) } });
  });
  return mcp;
};

if (import.meta.filename === process.argv[1]) {
  const wallet = walletFor(env('BUYER_MNEMONIC'), blockfrost());
  await createMcpServer(process.env.SERVER_URL || 'http://localhost:4021', payingFetch(wallet)).connect(new StdioServerTransport());
}
