#!/usr/bin/env node
/**
 * patch-db.ts — Insert seed overrides into an existing database.
 *
 * Reads all JSON files from data/seed/ and inserts any documents that are
 * not already present in data/database.db. This lets us patch the downloaded
 * release database with new or corrected entries without a full rebuild.
 *
 * Usage: node --import tsx scripts/patch-db.ts
 */

import Database from 'better-sqlite3';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const SEED_DIR = path.resolve(__dirname, '../data/seed');
const DB_PATH = path.resolve(__dirname, '../data/database.db');

interface ProvisionSeed {
  provision_ref: string;
  chapter?: string;
  section: string;
  title?: string;
  content: string;
}

interface DocumentSeed {
  id: string;
  type: string;
  title: string;
  title_en?: string;
  short_name?: string;
  status: string;
  issued_date?: string;
  in_force_date?: string;
  url?: string;
  description?: string;
  provisions?: ProvisionSeed[];
}

if (!fs.existsSync(DB_PATH)) {
  console.log('[patch-db] No database found at', DB_PATH, '— skipping patch.');
  process.exit(0);
}

if (!fs.existsSync(SEED_DIR)) {
  console.log('[patch-db] No seed directory found — nothing to patch.');
  process.exit(0);
}

const seedFiles = fs.readdirSync(SEED_DIR).filter(f => f.endsWith('.json'));
if (seedFiles.length === 0) {
  console.log('[patch-db] No seed files found — nothing to patch.');
  process.exit(0);
}

const db = new Database(DB_PATH);

const insertDoc = db.prepare(`
  INSERT OR IGNORE INTO legal_documents
    (id, type, title, title_en, short_name, status, issued_date, in_force_date, url, description)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

const insertProvision = db.prepare(`
  INSERT OR IGNORE INTO legal_provisions
    (document_id, provision_ref, chapter, section, title, content, metadata)
  VALUES (?, ?, ?, ?, ?, ?, ?)
`);

let patched = 0;
let skipped = 0;

const patchAll = db.transaction(() => {
  for (const file of seedFiles) {
    const filePath = path.join(SEED_DIR, file);
    const seed = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as DocumentSeed;

    const existing = db.prepare('SELECT id FROM legal_documents WHERE id = ?').get(seed.id);
    if (existing) {
      skipped++;
      continue;
    }

    insertDoc.run(
      seed.id, seed.type, seed.title, seed.title_en ?? null,
      seed.short_name ?? null, seed.status,
      seed.issued_date ?? null, seed.in_force_date ?? null,
      seed.url ?? null, seed.description ?? null,
    );

    for (const prov of seed.provisions ?? []) {
      insertProvision.run(
        seed.id, prov.provision_ref, prov.chapter ?? null,
        prov.section, prov.title ?? null, prov.content, null,
      );
    }

    console.log(`[patch-db] Inserted: ${seed.id} (${seed.provisions?.length ?? 0} provisions)`);
    patched++;
  }
});

patchAll();

console.log(`[patch-db] Done: ${patched} inserted, ${skipped} already present.`);
db.close();
