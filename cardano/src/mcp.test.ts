import assert from 'node:assert/strict';
import { test } from 'node:test';

const textOf = (r: unknown) => JSON.parse((r as { content: { text: string }[] }).content[0]!.text);
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { payingFetch, walletFor } from './cardano.ts';
import { BUYER, fakeBlockfrost, listen, SELLER } from './fixture.test-util.ts';
import { createMcpServer } from './mcp.ts';
import { createApp, localFacilitator } from './server.ts';

test('an LLM agent lists flights for free and buys a verdict through MCP', async (t) => {
  const { provider, state } = await fakeBlockfrost(t, [walletFor(BUYER).getAddress()]);
  const origin = await listen(await createApp({ facilitator: localFacilitator(provider, 50), payTo: walletFor(SELLER).getAddress() }), t);
  const [a, b] = InMemoryTransport.createLinkedPair();
  await createMcpServer(origin, payingFetch(walletFor(BUYER, provider))).connect(a);
  const client = new Client({ name: 'test', version: '0' });
  await client.connect(b);
  t.after(() => client.close());

  const tools = (await client.listTools()).tools.map((x) => x.name).sort();
  assert.deepEqual(tools, ['get_flight_verdict', 'list_flights']);
  const listed = textOf(await client.callTool({ name: 'list_flights', arguments: {} }));
  assert.equal(listed[0].flight, 'IB1314');
  assert.equal(state.submitted.length, 0);

  const bought = await client.callTool({ name: 'get_flight_verdict', arguments: { flight: 'IB1314', date: '2026-10-30' } });
  const body = textOf(bought);
  assert.equal(body.verdict.status, 'Expected');
  assert.equal(body.receipt.transaction, state.submitted[0]!.hash);
  assert.match(body.receipt.explorer, /preprod\.cardanoscan\.io/);
});
