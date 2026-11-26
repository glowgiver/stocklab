// Fasst alle Migrationen zu EINER Datei zusammen — zum Einfügen in den Supabase-SQL-Editor.
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
const dir = join(import.meta.dirname, '..', 'supabase', 'migrations')
const out = readdirSync(dir).filter(f => f.endsWith('.sql')).sort()
  .map(f => `-- ═══ ${f} ═══\n${readFileSync(join(dir, f), 'utf8')}`).join('\n')
writeFileSync(join(import.meta.dirname, '..', 'supabase', 'all_migrations.sql'), out)
console.log(`supabase/all_migrations.sql (${out.length} Zeichen)`)
