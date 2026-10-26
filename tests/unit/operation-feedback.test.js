import test from 'node:test';
import assert from 'node:assert/strict';
import {withOperation} from '../../src/feedback/OperationFeedback.js';

function fixture() {
  const attributes = new Map();
  const button = {dataset: {}, disabled: false, setAttribute: (k,v) => attributes.set(k,v), removeAttribute: k => attributes.delete(k)};
  return {button, attributes, event: {type: 'submit', submitter: button, target: {id: 'otpVerifyForm'}, preventDefault() { this.prevented = true; }}};
}

test('async submissions show pending state and reject duplicates until completion', async () => {
  const {button, attributes, event} = fixture();
  let release, calls = 0;
  const operation = withOperation(async () => { calls++; await new Promise(resolve => release = resolve); });
  const first = operation(event);
  assert.equal(button.disabled, true);
  assert.equal(attributes.get('aria-busy'), 'true');
  await operation(event);
  assert.equal(calls, 1);
  assert.equal(event.prevented, true);
  release(); await first;
  assert.equal(button.disabled, false);
  assert.equal(attributes.has('aria-busy'), false);
  await withOperation(() => calls++)(event);
  assert.equal(calls, 2);
});

test('failed operation reports its cause, restores the control and permits retry', async () => {
  const {button, event} = fixture();
  const messages = [];
  await withOperation(async () => { throw new Error('Supabase 403'); }, {report: (...args) => messages.push(args)})(event);
  assert.equal(messages[0][0], 'Действие не выполнено: Supabase 403');
  assert.equal(messages[0][1].kind, 'error');
  assert.equal(button.disabled, false);
  let retried = false;
  await withOperation(() => retried = true)(event);
  assert.equal(retried, true);
});
