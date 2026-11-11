import { describe, expect, it } from 'vitest';
import { createGraphClient, GraphError } from '../server/whatsapp/graph';

/** A Graph API stand-in that answers each send with the next queued response. */
function stub(responses: { status: number; body: unknown }[]) {
  const sent: Record<string, unknown>[] = [];
  const fetch = (async (_url: string, init?: RequestInit) => {
    sent.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
    const next = responses.shift() ?? { status: 200, body: { messages: [{ id: 'wamid.out' }] } };
    return new Response(JSON.stringify(next.body), {
      status: next.status,
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof globalThis.fetch;
  const graph = createGraphClient({ accessToken: 'test', phoneNumberId: '1001', fetch });
  return { graph, sent };
}

const notAllowed = {
  status: 400,
  body: {
    error: {
      code: 131030,
      message: '(#131030) Recipient phone number not in allowed list',
      error_data: { details: 'Add recipient phone number to recipient list and try again.' },
    },
  },
};

describe('Replies on a test number whose allowed list matches phone numbers only', () => {
  it('sends to the phone number when Meta refuses the BSUID with 131030', async () => {
    const { graph, sent } = stub([notAllowed]);
    await graph.sendText({ bsuid: 'IN.1001', waId: '919800000001' }, 'hello');
    expect(sent).toHaveLength(2);
    expect(sent[0]).toMatchObject({ recipient: 'IN.1001', text: { body: 'hello' } });
    expect(sent[1]).toMatchObject({ to: '919800000001', text: { body: 'hello' } });
    expect(sent[1]).not.toHaveProperty('recipient');
  });

  it('does not retry other errors, and keeps Meta reason out of the message', async () => {
    const { graph, sent } = stub([
      { status: 400, body: { error: { code: 131047, message: 'Re-engagement message' } } },
    ]);
    const error = await graph
      .sendText({ bsuid: 'IN.1001', waId: '919800000001' }, 'hello')
      .catch((caught: unknown) => caught);
    expect(sent).toHaveLength(1);
    expect(error).toBeInstanceOf(GraphError);
    expect(error).toMatchObject({
      status: 400,
      code: 131047,
      message: 'Sending a message failed with HTTP 400.',
      detail: '131047 / Re-engagement message',
    });
  });

  it('cannot fall back without a phone number', async () => {
    const { graph, sent } = stub([notAllowed]);
    await expect(graph.sendText({ bsuid: 'IN.1001' }, 'hello')).rejects.toMatchObject({
      code: 131030,
    });
    expect(sent).toHaveLength(1);
  });
});
