export const secretUpsertSql = `INSERT INTO secrets (name, scope, package_name, description, iv, ciphertext, key_id, created_at, updated_at)
 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
 ON CONFLICT(name, scope, package_name) DO UPDATE SET
   description = COALESCE(excluded.description, secrets.description),
   iv = excluded.iv, ciphertext = excluded.ciphertext, key_id = excluded.key_id, updated_at = excluded.updated_at`
