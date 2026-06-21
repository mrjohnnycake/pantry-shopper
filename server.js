require('dotenv').config();
const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3006;
const DATA_DIR = path.join(__dirname, 'data');
const CATALOG_FILE = path.join(DATA_DIR, 'catalog.json');
const LIST_FILE = path.join(DATA_DIR, 'list.json');
const PENDING_FILE = path.join(DATA_DIR, 'pending.json');

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(CATALOG_FILE)) fs.writeFileSync(CATALOG_FILE, JSON.stringify(defaultCatalog(), null, 2));
if (!fs.existsSync(LIST_FILE)) fs.writeFileSync(LIST_FILE, JSON.stringify([], null, 2));
if (!fs.existsSync(PENDING_FILE)) fs.writeFileSync(PENDING_FILE, JSON.stringify([], null, 2));

app.use(express.json({ limit: '50mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// --- Catalog ---
app.get('/api/catalog', (req, res) => res.json(JSON.parse(fs.readFileSync(CATALOG_FILE))));
app.put('/api/catalog', (req, res) => { fs.writeFileSync(CATALOG_FILE, JSON.stringify(req.body, null, 2)); res.json({ ok: true }); });

// --- List ---
app.get('/api/list', (req, res) => res.json(JSON.parse(fs.readFileSync(LIST_FILE))));
app.put('/api/list', (req, res) => { fs.writeFileSync(LIST_FILE, JSON.stringify(req.body, null, 2)); res.json({ ok: true }); });
app.delete('/api/list', (req, res) => { fs.writeFileSync(LIST_FILE, JSON.stringify([], null, 2)); res.json({ ok: true }); });

// --- Pending items (saved for later) ---
app.get('/api/pending', (req, res) => res.json(JSON.parse(fs.readFileSync(PENDING_FILE))));

app.post('/api/pending', (req, res) => {
  // items: array of { spoken, qty, type: 'ambiguous'|'unknown' }
  const { items } = req.body;
  const pending = JSON.parse(fs.readFileSync(PENDING_FILE));
  const withIds = items.map(i => ({
    id: 'pending-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7),
    spoken: i.spoken,
    qty: i.qty || 1,
    type: i.type || 'unknown',
    addedAt: new Date().toISOString()
  }));
  const merged = [...pending, ...withIds];
  fs.writeFileSync(PENDING_FILE, JSON.stringify(merged, null, 2));
  res.json({ pending: merged });
});

app.delete('/api/pending/:id', (req, res) => {
  const pending = JSON.parse(fs.readFileSync(PENDING_FILE));
  const filtered = pending.filter(p => p.id !== req.params.id);
  fs.writeFileSync(PENDING_FILE, JSON.stringify(filtered, null, 2));
  res.json({ pending: filtered });
});

// --- Pre-filter catalog by transcript keywords ---
// Returns the top N most relevant items so we don't send 369 items to Claude every time
const STOPWORDS = new Set([
  'a','an','the','and','or','of','some','few','couple','need','get','buy','please',
  'me','my','us','we','i','want','like','more','few','lot','pack','bag','box','can',
  'jar','bottle','gallon','lb','lbs','oz','dozen','bunch','piece','pieces','item','items'
]);
const MAX_CATALOG_ITEMS = 60;

function preFilterCatalog(transcript, catalogItems) {
  // Tokenize transcript into meaningful words
  const words = transcript.toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 2 && !STOPWORDS.has(w));

  if (words.length === 0) return catalogItems.slice(0, MAX_CATALOG_ITEMS);

  // Score each catalog item by keyword overlap
  const scored = catalogItems.map(item => {
    const itemText = (item.item || '').toLowerCase();
    let score = 0;
    for (const word of words) {
      if (itemText.includes(word)) score += 2;           // full word match
      else if (word.length > 4) {
        // partial stem match — "yogurts" matches "yogurt"
        const stem = word.slice(0, -1);
        if (itemText.includes(stem)) score += 1;
      }
    }
    return { item, score };
  });

  // Always include items with any score, pad with top unscored items up to MAX
  const matched = scored.filter(s => s.score > 0).sort((a, b) => b.score - a.score);
  const unmatched = scored.filter(s => s.score === 0);

  const result = matched.map(s => s.item);
  const needed = MAX_CATALOG_ITEMS - result.length;
  if (needed > 0) result.push(...unmatched.slice(0, needed).map(s => s.item));

  return result;
}

// --- Transcribe audio via Whisper ---
app.post('/api/transcribe', async (req, res) => {
  const { audio, mimeType } = req.body;
  const openaiKey = process.env.OPENAI_API_KEY;
  if (!openaiKey) return res.status(400).json({ error: 'OPENAI_API_KEY not set in .env' });
  try {
    const audioBuffer = Buffer.from(audio, 'base64');
    const ext = mimeType.includes('ogg') ? 'ogg' : mimeType.includes('mp4') ? 'mp4' : 'webm';
    const audioBlob = new Blob([audioBuffer], { type: mimeType });
    const form = new FormData();
    form.append('file', audioBlob, `recording.${ext}`);
    form.append('model', 'whisper-1');
    form.append('language', 'en');
    const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${openaiKey}` },
      body: form
    });
    const data = await response.json();
    if (data.error) return res.status(500).json({ error: data.error.message });
    res.json({ transcript: data.text });
  } catch (err) {
    console.error('Whisper error:', err);
    res.status(500).json({ error: err.message });
  }
});

// --- Parse transcript via Claude ---
app.post('/api/parse', async (req, res) => {
  const { transcript } = req.body;
  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  if (!anthropicKey) return res.status(400).json({ error: 'ANTHROPIC_API_KEY not set in .env' });

  const catalog = JSON.parse(fs.readFileSync(CATALOG_FILE));

  // Pre-filter to most relevant items before sending to Claude
  const filteredItems = preFilterCatalog(transcript, catalog.items);
  console.log(`Catalog pre-filter: ${catalog.items.length} items → ${filteredItems.length} sent to Claude`);

  const catalogSummary = filteredItems.map(item =>
    `id="${item.id}" item="${item.item}" store="${item.store}" aisle="${item.aisle}" aisleOrder=${item.aisleOrder} unit="${item.unit||''}" size="${item.size||''}" stock="${item.stock||''}"`
  ).join('\n');

  const prompt = `You are a shopping list assistant. Parse this voice/text transcript into a structured shopping list using the catalog below.

CATALOG:
${catalogSummary}

TRANSCRIPT: "${transcript}"

Instructions:
- For each thing mentioned, find matching catalog entries using fuzzy matching.
- A single spoken item may match MULTIPLE catalog entries (e.g. "bananas" matches both "Bananas, by the bunch" at Costco AND "Bananas, by the pound" at WinCo). Include ALL matches.
- Extract quantity ("two cans" = qty 2, default 1).
- Classify each result as one of:
  - "confirmed": exactly one clear catalog match, high confidence
  - "ambiguous": multiple possible catalog matches OR low confidence match — include all candidate matches
  - "unknown": no catalog match at all

Return ONLY a JSON object (no markdown):
{
  "confirmed": [
    { "id": "catalog-id", "item": "item name", "qty": 1, "unit": "unit", "store": "store", "aisle": "aisle", "aisleOrder": 1, "size": "size", "stock": "stock", "checked": false, "catalogMatch": true }
  ],
  "ambiguous": [
    {
      "spoken": "what the user said",
      "qty": 1,
      "candidates": [
        { "id": "catalog-id", "item": "item name", "qty": 1, "unit": "unit", "store": "store", "aisle": "aisle", "aisleOrder": 1, "size": "size", "stock": "stock", "checked": false, "catalogMatch": true },
        { "id": "catalog-id-2", "item": "item name 2", "qty": 1, "unit": "unit", "store": "store2", "aisle": "aisle", "aisleOrder": 1, "size": "size", "stock": "stock", "checked": false, "catalogMatch": true }
      ]
    }
  ],
  "unknown": [
    { "spoken": "what the user said", "qty": 1, "item": "best guess name", "unit": "" }
  ]
}`;

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': anthropicKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: process.env.ANTHROPIC_MODEL || 'claude-haiku-4-5',
        max_tokens: 4000,
        messages: [{ role: 'user', content: prompt }]
      })
    });
    const data = await response.json();
    // console.log('Anthropic response:', JSON.stringify(data, null, 2));
    if (data.error) return res.status(500).json({ error: data.error.message });
    const text = data.content[0].text.trim();
    const parsed = JSON.parse(text.replace(/```json|```/g, '').trim());
    res.json(parsed);
  } catch (err) {
    console.error('Claude error:', err);
    res.status(500).json({ error: err.message });
  }
});

// --- Re-match a single pending item against the CURRENT catalog ---
// Used when the user opens a pending item later — always re-runs fresh (Option B)
app.post('/api/pending/rematch', async (req, res) => {
  const { spoken, qty } = req.body;
  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  if (!anthropicKey) return res.status(400).json({ error: 'ANTHROPIC_API_KEY not set in .env' });

  const catalog = JSON.parse(fs.readFileSync(CATALOG_FILE));
  const filteredItems = preFilterCatalog(spoken, catalog.items);

  const catalogSummary = filteredItems.map(item =>
    `id="${item.id}" item="${item.item}" store="${item.store}" aisle="${item.aisle}" aisleOrder=${item.aisleOrder} unit="${item.unit||''}" size="${item.size||''}" stock="${item.stock||''}"`
  ).join('\n');

  const prompt = `You are a shopping list assistant. Find catalog matches for this single item using the catalog below.

CATALOG:
${catalogSummary}

ITEM: "${spoken}"

Instructions:
- Find matching catalog entries using fuzzy matching. Include ALL plausible matches (e.g. the same item at multiple stores).
- Classify as one of:
  - "confirmed": exactly one clear catalog match, high confidence
  - "ambiguous": multiple possible catalog matches OR low confidence — include all candidates
  - "unknown": no catalog match at all

Return ONLY a JSON object (no markdown):
{
  "result": "confirmed" | "ambiguous" | "unknown",
  "match": { "id": "catalog-id", "item": "item name", "unit": "unit", "store": "store", "aisle": "aisle", "aisleOrder": 1, "size": "size", "stock": "stock" },
  "candidates": [
    { "id": "catalog-id", "item": "item name", "unit": "unit", "store": "store", "aisle": "aisle", "aisleOrder": 1, "size": "size", "stock": "stock" }
  ]
}
Only include "match" if result is "confirmed". Only include "candidates" if result is "ambiguous". Omit both if "unknown".`;

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': anthropicKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: process.env.ANTHROPIC_MODEL || 'claude-haiku-4-5',
        max_tokens: 1500,
        messages: [{ role: 'user', content: prompt }]
      })
    });
    const data = await response.json();
    if (data.error) return res.status(500).json({ error: data.error.message });
    const text = data.content[0].text.trim();
    const parsed = JSON.parse(text.replace(/```json|```/g, '').trim());
    res.json(parsed);
  } catch (err) {
    console.error('Claude rematch error:', err);
    res.status(500).json({ error: err.message });
  }
});

// --- Commit resolved items to the list ---
app.post('/api/list/add', (req, res) => {
  const { items } = req.body;
  const currentList = JSON.parse(fs.readFileSync(LIST_FILE));
  const merged = [...currentList];
  for (const newItem of items) {
    const existing = merged.find(i =>
      i.id === newItem.id ||
      (i.item || i.name || '').toLowerCase() === (newItem.item || newItem.name || '').toLowerCase() &&
      i.store === newItem.store
    );
    if (existing) {
      existing.qty += newItem.qty;
    } else {
      merged.push({ ...newItem, id: newItem.id || slugify(newItem.item || newItem.name || 'item') });
    }
  }
  merged.sort((a, b) => {
    if (a.store < b.store) return -1;
    if (a.store > b.store) return 1;
    return (a.aisleOrder || 999) - (b.aisleOrder || 999);
  });
  fs.writeFileSync(LIST_FILE, JSON.stringify(merged, null, 2));
  res.json({ list: merged });
});

function slugify(str) {
  return str.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') + '-' + Date.now();
}

function defaultCatalog() {
  return { stores: [{ id: 'costco', name: 'Costco' }, { id: 'winco', name: 'WinCo' }], items: [] };
}

app.listen(PORT, () => console.log(`Pantry Shopper running at http://localhost:${PORT}`));
