// MCP server for LLM agents: `list_flights` is free; `get_flight_verdict` and `buy_flight_cover` pay on Cardano via x402.
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
  mcp.registerTool('buy_flight_cover', {
    description: 'Paid (tADA on Cardano preprod via x402). Buys a FlightDelayCover policy on Base Sepolia for `holder` '
      + '(pays out 50% at ≥120 min delay, 100% at ≥180 min or cancellation). The policy is bought after the Cardano payment '
      + 'settles and records the payment as cardanoJobRef. Only works before departure. Returns the order and the Base policy.',
    inputSchema: {
      flight: z.string().regex(/^[A-Za-z0-9]{3,10}$/), date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      holder: z.string().regex(/^0x[0-9a-fA-F]{40}$/), coverage: z.string().regex(/^[1-9]\d{0,18}$/).describe('aUSD units, 500000 = 0.5 aUSD'),
    },
  }, async ({ flight, date, holder, coverage }) => {
    try {
      const { buyPolicy } = await import('./buy-policy.ts');
      const { receipt, order } = await buyPolicy({ server, flight, date, holder, coverage, pay, log: () => {} });
      return { ...text({ order, payment: { ...receipt, explorer: txLink(receipt.transaction) } }), isError: order.status !== 'bought' };
    } catch (e) {
      return { ...text({ error: e instanceof Error ? e.message : String(e) }), isError: true };
    }
  });
  return mcp;
};

if (import.meta.filename === process.argv[1]) {
  const wallet = walletFor(env('BUYER_MNEMONIC'), blockfrost());
  await createMcpServer(process.env.SERVER_URL || 'http://localhost:4021', payingFetch(wallet)).connect(new StdioServerTransport());
}
