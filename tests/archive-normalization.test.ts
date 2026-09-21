import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeArchiveDocument } from '../src/connectors/archive-import';

test('ChatGPT archives become bounded, time-aware conversation messages', () => {
  const items = normalizeArchiveDocument('chatgpt', {
    name: 'conversations.json',
    value: [{
      id: 'conversation-1',
      title: 'A useful conversation',
      mapping: {
        node1: {
          message: {
            id: 'message-1',
            author: { role: 'user' },
            create_time: 1_700_000_000,
            content: { parts: ['Help me plan a thoughtful project.'] },
          },
        },
      },
    }],
  });

  assert.equal(items.length, 1);
  assert.equal(items[0].providerObjectId, 'conversation-1:message-1');
  assert.equal(items[0].canonicalType, 'communication');
  assert.match(items[0].canonicalText ?? '', /user: Help me plan/);
  assert.equal(items[0].occurredAt, '2023-11-14T22:13:20.000Z');
});

test('Netflix CSV-shaped records become stable viewing events', () => {
  const document = {
    name: 'ViewingActivity.csv',
    value: [{ Title: 'Example Show: Episode 1', Date: '6/1/26' }],
  };
  const first = normalizeArchiveDocument('netflix', document);
  const second = normalizeArchiveDocument('netflix', document);

  assert.equal(first.length, 1);
  assert.equal(first[0].providerObjectType, 'viewing_event');
  assert.equal(first[0].providerObjectId, second[0].providerObjectId);
  assert.match(first[0].canonicalText ?? '', /Watched Example Show/);
});

test('Unknown provider exports retain exact payloads and deterministic identities', () => {
  const document = { name: 'records.json', value: [{ id: 'record-1', note: 'A durable thought' }] };
  const items = normalizeArchiveDocument('unknown_provider', document);

  assert.equal(items[0].providerObjectId, 'records.json:record-1');
  assert.deepEqual(items[0].payload, document.value[0]);
  assert.match(items[0].canonicalText ?? '', /A durable thought/);
});
