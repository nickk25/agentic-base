import assert from 'node:assert/strict'
import { test } from 'node:test'
import { evaluate, planFor } from './coupling.mjs'

const range = { base: null, head: 'HEAD', source: 'no-base' }
const change = (path, status = 'M') => ({ status, path })

const moduleContract = {
  id: 'module-contract',
  when: ['src/{module}/**', '!src/{module}/CLAUDE.md'],
  require: [{ kind: 'changed', paths: ['src/{module}/CLAUDE.md'] }],
}

test('a captured rule fans out once per module actually touched', () => {
  // @invariant INV-coupling-01
  const violations = evaluate({
    rules: [moduleContract],
    changes: [change('src/core/plan.ts'), change('src/llm/client.ts')],
    range,
  })
  assert.equal(violations.length, 2)
  assert.deepEqual(violations.map((v) => v.bindings.module).sort(), ['core', 'llm'])
})

test('a rule stays silent for modules the change set never touches', () => {
  // @invariant INV-coupling-02
  const violations = evaluate({
    rules: [moduleContract],
    changes: [change('README.md')],
    range,
  })
  assert.equal(violations.length, 0)
})

test('the capture is substituted into the requirement, per module', () => {
  // @invariant INV-coupling-03
  const violations = evaluate({
    rules: [moduleContract],
    changes: [change('src/core/plan.ts'), change('src/core/CLAUDE.md')],
    range,
  })
  assert.equal(violations.length, 0, 'core satisfied its own contract, not some other module\'s')
})

test('`added` refuses a modified file where a new one was required', () => {
  // @invariant INV-coupling-04
  const rule = {
    id: 'schema-migration',
    when: ['db/schema.ts'],
    require: [{ kind: 'added', paths: ['db/migrations/*.sql'] }],
  }
  const modified = evaluate({
    rules: [rule],
    changes: [change('db/schema.ts'), change('db/migrations/001.sql', 'M')],
    range,
  })
  assert.equal(modified.length, 1, 'editing an old migration is not adding one')

  const created = evaluate({
    rules: [rule],
    changes: [change('db/schema.ts'), change('db/migrations/002.sql', 'A')],
    range,
  })
  assert.equal(created.length, 0)
})

test('a label requirement reads the labels on the pull request', () => {
  // @invariant INV-coupling-05
  const rule = {
    id: 'protected',
    when: ['coupling.yaml'],
    require: [{ kind: 'label', name: 'human-approved' }],
  }
  const changes = [change('coupling.yaml')]
  assert.equal(evaluate({ rules: [rule], changes, range, labels: [] }).length, 1)
  assert.equal(evaluate({ rules: [rule], changes, range, labels: ['human-approved'] }).length, 0)
})

test('plan mode never executes a command requirement', () => {
  // @invariant INV-coupling-06
  // The whole value of `--plan` is that an agent can ask what a change will cost
  // before making it. Running the commands would make asking as expensive as doing.
  const rule = {
    id: 'boom',
    when: ['a.ts'],
    require: [{ kind: 'command', run: 'exit 1' }],
  }
  const violations = evaluate({ rules: [rule], changes: [change('a.ts')], range, plan: true })
  assert.equal(violations.length, 0)

  const plan = planFor([rule], ['a.ts'])
  assert.equal(plan.length, 1)
  assert.match(plan[0].obligations[0], /exit 1/)
})

test('a failing command reports its own output, not just its exit code', () => {
  // @invariant INV-coupling-07
  // An agent that only learns "the command failed" has to re-run it to find out
  // why, which costs a cycle. The tail of the output is the whole point.
  const violations = evaluate({
    rules: [{ id: 'noisy', when: ['a.ts'], require: [{ kind: 'command', run: 'echo "the actual reason" >&2; exit 1' }] }],
    changes: [change('a.ts')],
    range,
  })
  assert.equal(violations.length, 1)
  assert.match(violations[0].detail, /the actual reason/)
})
