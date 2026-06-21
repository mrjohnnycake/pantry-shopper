#!/usr/bin/env node
/**
 * Convert a catalog spreadsheet (.xlsx, .xls, or .csv) into data/catalog.json
 *
 * Usage:
 *   node scripts/convert-catalog.js path/to/your-catalog.xlsx
 *   node scripts/convert-catalog.js path/to/your-catalog.xlsx --out data/catalog.json
 *
 * Expected columns (header row, any order, case-insensitive):
 *   id, item, store, aisle, aisleOrder, unit, stock, size
 *
 * - "id" is optional — if missing, one is generated from the item name.
 * - "stock" and "size" may be left blank or set to "?" as a reminder to fill in later.
 * - "unit" may be left blank for items you refer to by name alone (e.g. "Bananas").
 */

const fs = require('fs');
const path = require('path');

function fail(msg) {
  console.error(`\nError: ${msg}\n`);
  process.exit(1);
}

const args = process.argv.slice(2);
if (args.length === 0) {
  fail('Please provide a path to your spreadsheet.\n  Example: node scripts/convert-catalog.js my-catalog.xlsx');
}

const inputPath = args[0];
const outFlagIdx = args.indexOf('--out');
const outputPath = outFlagIdx !== -1 && args[outFlagIdx + 1]
  ? args[outFlagIdx + 1]
  : path.join('data', 'catalog.json');

if (!fs.existsSync(inputPath)) {
  fail(`File not found: ${inputPath}`);
}

let XLSX;
try {
  XLSX = require('xlsx');
} catch (e) {
  fail(
    'The "xlsx" package is required for this script but is not installed.\n' +
    '  Run: npm install --no-save xlsx\n' +
    '  Then try again.'
  );
}

const ext = path.extname(inputPath).toLowerCase();
if (!['.xlsx', '.xls', '.csv'].includes(ext)) {
  fail(`Unsupported file type "${ext}". Use .xlsx, .xls, or .csv`);
}

const workbook = XLSX.readFile(inputPath);
const sheetName = workbook.SheetNames[0];
const sheet = workbook.Sheets[sheetName];
const rows = XLSX.utils.sheet_to_json(sheet, { defval: '' });

if (rows.length === 0) {
  fail('No rows found in the spreadsheet. Is the first sheet the right one?');
}

// Normalize header keys (case-insensitive lookup)
function getField(row, ...names) {
  for (const key of Object.keys(row)) {
    if (names.includes(key.toLowerCase().trim())) {
      return row[key];
    }
  }
  return '';
}

function slugify(str) {
  return String(str || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

const items = [];
const stores = [];
const seenStores = new Set();
const seenIds = new Set();
let warnings = 0;

rows.forEach((row, i) => {
  const itemName = String(getField(row, 'item', 'name', 'product') || '').trim();
  const store = String(getField(row, 'store') || '').trim();

  if (!itemName) {
    console.warn(`  ⚠ Row ${i + 2}: missing item name — skipped`);
    warnings++;
    return;
  }
  if (!store) {
    console.warn(`  ⚠ Row ${i + 2} ("${itemName}"): missing store — skipped`);
    warnings++;
    return;
  }

  let id = String(getField(row, 'id') || '').trim();
  if (!id) id = slugify(itemName);
  if (seenIds.has(id)) {
    id = `${id}-${i}`;
  }
  seenIds.add(id);

  const aisleOrderRaw = getField(row, 'aisleorder', 'aisle order', 'order');
  const aisleOrder = aisleOrderRaw === '' || aisleOrderRaw === '?' ? 99 : parseInt(aisleOrderRaw, 10);

  const stockRaw = getField(row, 'stock', 'keep', 'qty to keep');
  const sizeRaw = getField(row, 'size');
  const unitRaw = getField(row, 'unit');
  const aisleRaw = getField(row, 'aisle');

  items.push({
    id,
    item: itemName,
    store,
    aisle: String(aisleRaw || '').trim(),
    aisleOrder: Number.isFinite(aisleOrder) ? aisleOrder : 99,
    unit: String(unitRaw || '').trim(),
    stock: String(stockRaw === '' ? '' : stockRaw).trim(),
    size: String(sizeRaw || '').trim()
  });

  if (!seenStores.has(store)) {
    seenStores.add(store);
    stores.push({ id: slugify(store), name: store });
  }
});

if (items.length === 0) {
  fail('No valid rows were converted. Check that your spreadsheet has "item" and "store" columns.');
}

const catalog = { stores, items };

const outDir = path.dirname(outputPath);
if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

if (fs.existsSync(outputPath)) {
  console.log(`\n⚠  ${outputPath} already exists.`);
  console.log('   This script will NOT overwrite it automatically.');
  console.log(`   Re-run with --out to write somewhere else, e.g.:`);
  console.log(`     node scripts/convert-catalog.js ${inputPath} --out data/catalog-new.json\n`);
  process.exit(1);
}

fs.writeFileSync(outputPath, JSON.stringify(catalog, null, 2));

console.log(`\n✓ Converted ${items.length} item(s) across ${stores.length} store(s): ${stores.map(s => s.name).join(', ')}`);
if (warnings > 0) console.log(`⚠ ${warnings} row(s) skipped — see warnings above`);
console.log(`✓ Wrote ${outputPath}\n`);
