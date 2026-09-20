const { test } = require('node:test');
const assert = require('node:assert/strict');
const core = require('../extensions/scratch-mode/core');
const project = blocks => ({ format: 'axiom-scratch', version: 1, blocks });
test('nested loops draw a square and round-trip through the project format', async () => {
  const data = project([core.block('penDown'), { type: 'repeat', value: 2, children: [{ type: 'repeat', value: 2, children: [{ type: 'move', value: 100 }, { type: 'turn', value: 90 }] }] }]);
  const parsed = core.validate(JSON.parse(JSON.stringify(data))); let lines = 0;
  const result = await core.execute(parsed.blocks, core.initialState(), { draw: (s, from, moved) => { if (s.pen && moved) lines++; } });
  assert.ok(Math.abs(result.x) < 0.00001); assert.ok(Math.abs(result.y) < 0.00001); assert.equal(lines, 4);
});
test('cancellation stops nested execution', async () => {
  let cancelled = false;
  const result = await core.execute([{ type: 'repeat', value: 1000, children: [core.block('move')] }], core.initialState(), { cancelled: () => cancelled, pause: async () => { cancelled = true; } });
  assert.equal(result.x, 30);
});
test('invalid projects and unsafe numeric values are rejected', () => {
  for (const blocks of [[{ type: 'eval' }], [{ type: 'move', value: Infinity }], [{ type: 'move', value: 1000000001 }], [{ type: 'repeat', value: -1, children: [] }], [{ type: 'wait', value: 4000 }], [{ type: 'say', value: 123 }]]) assert.throws(() => core.validate(project(blocks)));
  assert.throws(() => core.validate({ format: 'sb3', version: 1, blocks: [] }));
});
test('execution budget prevents runaway empty loops', async () => {
  const blocks = [{ type: 'repeat', value: 1000, children: [{ type: 'repeat', value: 1000, children: [] }] }];
  await assert.rejects(core.execute(blocks, core.initialState()), /1\.000\.000/);
});

test('Scratch 2.3 expanded limits accept large projects and long execution', async () => {
  assert.equal(core.LIMITS.maxBlocks, 50000);
  assert.equal(core.LIMITS.maxDepth, 64);
  assert.equal(core.LIMITS.maxSteps, 1000000);
  const many = Array.from({length:5000}, () => core.block('home'));
  assert.equal(core.validate(project(many)).blocks.length, 5000);
  const result = await core.execute([{type:'repeat',value:25000,children:[{type:'turn',value:1}]}], core.initialState());
  assert.equal(result.direction, 25000 % 360);
});