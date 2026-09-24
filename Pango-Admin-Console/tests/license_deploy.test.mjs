import test from 'node:test'
import assert from 'node:assert/strict'
import { preparationConfig, migrationDefinitions, missingTables } from '../scripts/prepare-license-deploy.mjs'

test('preparation mode replaces duplicate flags while preserving private settings', () => {
  const original = '# comment\r\nPANGO_DB_PASSWORD="test=only"\r\n LICENSE_SEND_ENABLED = true\r\nLICENSE_SEND_ENABLED=false\r\nLICENSE_DELIVERY_ENABLED=false\r\n'
  const updated = preparationConfig(original)
  assert.equal(updated.match(/LICENSE_SEND_ENABLED=/g).length, 1)
  assert.match(updated, /LICENSE_SEND_ENABLED=false/)
  assert.match(updated, /LICENSE_DELIVERY_ENABLED=true/)
  assert.match(updated, /PANGO_DB_PASSWORD="test=only"/)
  assert.equal(preparationConfig(updated), updated)
})

test('only the seven additive admin tables are eligible; portal ALTER is excluded', async () => {
  const definitions = await migrationDefinitions()
  assert.equal(definitions.length, 7)
  assert.ok(definitions.every(item => item.columns.length && !/\b(?:ALTER|DROP|DELETE|UPDATE|INSERT)\s/i.test(item.sql)))
  const db = { query: async sql => {
    assert.match(sql, /^SELECT TABLE_NAME/)
    return [[{ TABLE_NAME: 'dto_license_application', ENGINE: 'InnoDB' }]]
  } }
  assert.equal((await missingTables(db, definitions)).length, 7)
})

test('wrong database and malformed existing tables stop deployment without DDL', async () => {
  const definitions = await migrationDefinitions()
  await assert.rejects(missingTables({ query: async () => [[]] }, definitions), /application table is missing/)
  const queries = []
  const db = { query: async sql => {
    queries.push(sql)
    if (sql.startsWith('SELECT TABLE_NAME')) return [[{ TABLE_NAME: 'dto_license_application', ENGINE: 'InnoDB' }, { TABLE_NAME: 'dto_license_file', ENGINE: 'MyISAM' }]]
    throw new Error('unexpected query')
  } }
  await assert.rejects(missingTables(db, definitions), /expected InnoDB/)
  assert.equal(queries.length, 1)
})

test('existing complete tables need no migrations; unique mail deduplication is required', async () => {
  const definitions = await migrationDefinitions()
  let indexRows = [{ Key_name: 'dedupe_key', Non_unique: 0, Column_name: 'dedupe_key' }]
  const db = { query: async sql => {
    if (sql.startsWith('SELECT TABLE_NAME')) return [[{ TABLE_NAME: 'dto_license_application', ENGINE: 'InnoDB' }, ...definitions.map(item => ({ TABLE_NAME: item.table, ENGINE: 'InnoDB' }))]]
    if (sql.startsWith('SHOW INDEX')) return [indexRows]
    assert.match(sql, /^SELECT .* LIMIT 0$/)
    return [[]]
  } }
  assert.deepEqual(await missingTables(db, definitions), [])
  indexRows = [{ Key_name: 'wrong', Non_unique: 0, Column_name: 'dedupe_key' }, { Key_name: 'wrong', Non_unique: 0, Column_name: 'id' }]
  await assert.rejects(missingTables(db, definitions), /unique dedupe_key/)
})
