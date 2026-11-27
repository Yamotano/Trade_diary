import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const sql = fs.readFileSync(new URL('../supabase/schema.sql', import.meta.url), 'utf8');

test('schema: RLS включён для всех пользовательских таблиц', () => {
  for (const table of ['accounts', 'instruments', 'trades', 'journal', 'cashflows']) {
    assert.match(sql, new RegExp(`alter table public\\.${table}\\s+enable row level security`, 'i'), table);
  }
});

test('schema: каждая таблица привязана к auth.uid()', () => {
  assert.match(sql, /user_id\s+uuid not null default auth\.uid\(\)/i);
  assert.equal((sql.match(/user_id = auth\.uid\(\)/g) || []).length >= 5, true);
  assert.match(sql, /grant select, insert, update, delete on public\.accounts/i);
  assert.match(sql, /grant usage, select on all sequences/i);
});

test('schema: уникальность дневника по пользователю и дате', () => {
  assert.match(sql, /unique \(user_id, date\)/i);
  assert.match(sql, /unique \(user_id, symbol\)/i);
});

test('schema: сделки проверяют владельца счёта в RLS', () => {
  assert.match(sql, /create policy trades_owner on public\.trades/i);
  assert.match(sql, /a\.id = trades\.account_id and a\.user_id = auth\.uid\(\)/i);
});
