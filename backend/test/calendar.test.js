import assert from 'node:assert/strict';
import test from 'node:test';
import { addBusinessMinutes, businessMinutesBetween } from '../src/services/calendar.js';

const calendar = {
  timezone: 'America/Sao_Paulo', business_days: [1, 2, 3, 4, 5],
  business_start: '09:00', business_end: '18:00', holidays: ['2026-11-20']
};

test('transfere o saldo do expediente para depois de feriado e fim de semana', () => {
  const start = '2026-11-19T20:40:00Z';
  const due = addBusinessMinutes(start, 35, calendar);
  assert.equal(due.toISOString(), '2026-11-23T12:15:00.000Z');
  assert.equal(businessMinutesBetween(start, due, calendar), 35);
});

test('inicia dentro do expediente para períodos antes da abertura', () => {
  const start = '2026-11-23T09:00:00Z';
  const due = addBusinessMinutes(start, 15, calendar);
  assert.equal(due.toISOString(), '2026-11-23T12:15:00.000Z');
  assert.equal(businessMinutesBetween(start, due, calendar), 15);
});

test('preserva limite exato do expediente e minutos fracionários', () => {
  const start = '2026-11-19T20:59:30Z';
  assert.equal(addBusinessMinutes(start, .5, calendar).toISOString(), '2026-11-19T21:00:00.000Z');
  assert.equal(businessMinutesBetween(start, '2026-11-19T21:00:00Z', calendar), .5);
});

test('mantém o horário local na transição do horário de verão', () => {
  const local = { ...calendar, timezone: 'America/New_York', holidays: [] };
  const start = '2026-03-06T22:30:00Z';
  const due = addBusinessMinutes(start, 60, local);
  assert.equal(due.toISOString(), '2026-03-09T13:30:00.000Z');
  assert.equal(businessMinutesBetween(start, due, local), 60);
});
