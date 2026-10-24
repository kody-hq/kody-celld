import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import test from 'node:test'
import { secretUpsertSql } from './storage-sql.ts'

test('saving an existing secret preserves its package grants', () => {
	const db = new DatabaseSync(':memory:')
	db.exec(`CREATE TABLE secrets (
		name TEXT NOT NULL,
		scope TEXT NOT NULL,
		package_name TEXT NOT NULL DEFAULT '',
		description TEXT,
		iv TEXT NOT NULL,
		ciphertext TEXT NOT NULL,
		key_id TEXT NOT NULL DEFAULT '',
		usage_json TEXT NOT NULL DEFAULT '{"mode":"any"}',
		created_at TEXT NOT NULL,
		updated_at TEXT NOT NULL,
		PRIMARY KEY (name, scope, package_name)
	)`)
	const save = db.prepare(secretUpsertSql)
	save.run('token', 'user', '', null, 'iv-1', 'ciphertext-1', 'key-1', 'created', 'updated-1')
	db.prepare('UPDATE secrets SET usage_json = ? WHERE name = ?').run(
		'{"mode":"packages","packages":["@example/app"]}',
		'token',
	)
	save.run('token', 'user', '', null, 'iv-2', 'ciphertext-2', 'key-2', 'created', 'updated-2')
	const row = db.prepare('SELECT usage_json FROM secrets WHERE name = ?').get('token') as { usage_json: string }
	assert.equal(row.usage_json, '{"mode":"packages","packages":["@example/app"]}')
	db.close()
})
