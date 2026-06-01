require('dotenv').config();
const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3006;
const DATA_DIR = path.join(__dirname, 'data');
const CATALOG_FILE = path.join(DATA_DIR, 'catalog.json');
const LIST_FILE = path.join(DATA_DIR, 'list.json');

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(CATALOG_FILE)) fs.writeFileSync(CATALOG_FILE, JSON.stringify(defaultCatalog(), null, 2));
if (!fs.existsSync(LIST_FILE)) fs.writeFileSync(LIST_FILE, JSON.stringify([], null, 2));

app.use(express.json({ limit: '50mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// --- Catalog ---
app.get('/api/catalog', (req, res) => res.json(JSON.parse(fs.readFileSync(CATALOG_FILE))));
app.put('/api/catalog', (req, res) => { fs.writeFileSync(CATALOG_FILE, JSON.stringify(req.body, null, 2)); res.json({ ok: true }); });

// --- List ---
app.get('/api/list', (req, res) => res.json(JSON.parse(fs.readFileSync(LIST_FILE))));
app.put('/api/list', (req, res) => { fs.writeFileSync(LIST_FILE, JSON.stringify(req.body, null, 2)); res.json({ ok: true }); });
app.delete('/api/list', (req, res) => { fs.writeFileSync(LIST_FILE, JSON.stringify([], null, 2)); res.json({ ok: true }); });

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
// Returns: confirmed items + items needing clarification + unknown items needing a store
app.post('/api/parse', async (req, res) => {
  const { transcript } = req.body;
  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  if (!anthropicKey) return res.status(400).json({ error: 'ANTHROPIC_API_KEY not set in .env' });

  const catalog = JSON.parse(fs.readFileSync(CATALOG_FILE));

  const catalogSummary = catalog.items.map(item =>
    `id="${item.id}" item="${item.item}" store="${item.store}" aisle="${item.aisle}" aisleOrder=${item.aisleOrder} unit="${item.unit||''}" size="${item.size||''}"`
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
    { "id": "catalog-id", "item": "item name", "qty": 1, "unit": "unit", "store": "store", "aisle": "aisle", "aisleOrder": 1, "size": "size", "checked": false, "catalogMatch": true }
  ],
  "ambiguous": [
    {
      "spoken": "what the user said",
      "qty": 1,
      "candidates": [
        { "id": "catalog-id", "item": "item name", "qty": 1, "unit": "unit", "store": "store", "aisle": "aisle", "aisleOrder": 1, "size": "size", "checked": false, "catalogMatch": true },
        { "id": "catalog-id-2", "item": "item name 2", "qty": 1, "unit": "unit", "store": "store2", "aisle": "aisle", "aisleOrder": 1, "size": "size", "checked": false, "catalogMatch": true }
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
        model: process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-6',
        max_tokens: 4000,
        messages: [{ role: 'user', content: prompt }]
      })
    });
    const data = await response.json();
    if (data.error) return res.status(500).json({ error: data.error.message });
    const text = data.content[0].text.trim();
    const parsed = JSON.parse(text.replace(/```json|```/g, '').trim());
    res.json(parsed);
  } catch (err) {
    console.error('Claude error:', err);
    res.status(500).json({ error: err.message });
  }
});

// --- Commit resolved items to the list ---
app.post('/api/list/add', (req, res) => {
  const { items } = req.body; // array of fully resolved items
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
