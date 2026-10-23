import test from 'node:test';
import assert from 'node:assert/strict';
import { parseRequest } from '../scripts/manage-isin.js';

test('richieste ISIN dal titolo della issue', () => {
  assert.deepEqual(parseRequest('Aggiungi ISIN IE00B4L5Y983'), { action: 'add', isin: 'IE00B4L5Y983' });
  assert.deepEqual(parseRequest('rimuovi isin: us0378331005'), { action: 'remove', isin: 'US0378331005' });
  assert.equal(parseRequest('Aggiungi ISIN IE00B4'), null);
  assert.equal(parseRequest('Bug nella pagina'), null);
  assert.equal(parseRequest('Aggiungi ISIN IE00B4L5Y983; rm -rf /').isin, 'IE00B4L5Y983');
});
