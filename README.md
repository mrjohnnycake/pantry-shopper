# Pantry Shopper

A voice-driven shopping list app built around the "working pantry" model — keep more of what you use, cycle through it, and replace what you ran out of. Instead of going row by row through a spreadsheet, just talk: say what you need, and Pantry Shopper figures out where you like to buy it, which aisle it's in, and then sorts your list so you can walk straight through each store.

**This was built with and relies on the use of AI and has a very small cost associated with it (see Requirements below for more on that). Because of the non-personal nature of the information I'm giving to the AI I'm comfortable relying on Claude and OpenAI for my needs although, to be fair, in my case there are a couple of local stores and products that would help an agent narrow down where I live. I don't personally see that as something to lose sleep over but I'm including this paragraph to let you know what you're getting into. If you are interested in using your own self-hosted LLM for data parsing I am open to adding in that option once I am comfortable with the stability and security of the initial release but for now you must use Claude and OpenAI for this app to function. If you need a local option sooner just fork the repo and adjust it to your own privacy concerns.**

## Features

### Voice Dictation
- Tap the mic and talk naturally — say as many items as you want in one session
- Long pauses are fine; the mic stays open and records continuously until you turn off the mic button.
- A live audio level bar and running timer confirm it's recording
- Tap again to stop; Whisper transcribes your audio server-side
- Tap Done again any time to add more items — each session appends to the list

### Typed Input
- The transcript box is fully editable — type directly if you can't talk, or fix anything Whisper got wrong before submitting

### AI-Powered Parsing
- Claude fuzzy-matches what you said to your product catalog ("bread" → "Sandwich Bread", "OJ" → "Orange Juice")
- Quantities are extracted naturally ("two cans", "a dozen", "three pounds")
- When a match is ambiguous, you're asked to clarify before anything is added

### Clarification Flow
- **Ambiguous items**: if Claude isn't sure which item you meant, a modal shows all the candidates as checkboxes — pick one, several, or skip
- **Multi-store items**: items that exist at multiple stores (e.g. bananas at Costco by the bunch, WinCo by the pound) show all options so you can add to one store or both
- **Unknown items**: if something isn't in your catalog, you're asked which store to put it under — it lands at the top of that store's list with a `?` badge so you can fill in the details later

### Smart Shopping List
- Sorted by store, then by the order you walk through each store (your custom aisle order)
- Color-coded store labels so you can see at a glance what's where
- Size shown on each item (e.g. "28 oz", "5 lb bag") as a reminder of what to grab
- Tap items to check them off as you shop
- Unknown/unmatched items flagged with a `?` badge
- List persists until you clear it — shared across all devices on the same URL
- Add items any time; each session appends to the existing list

### Product Catalog
- Manage all your pantry items with store, aisle, aisle order, unit, stock level, and size
- Use `?` in stock or size fields as a reminder to fill in later
- Add and remove stores
- Supports multiple entries for the same item at different stores


---

## Requirements

- Docker (these instructions use Docker Compose)
- An Anthropic API key — https://console.anthropic.com
- An OpenAI API key — https://platform.openai.com (used for Whisper audio transcription)
- You need to build your own catalog as my data will probably be useless to you unless you live in my vicinity. I have included `catalog-example.xlsx` as a starting point — every product is something I buy and from the store I buy it at. Edit it to your liking in a spreadsheet, then see **[Building Your Catalog](#building-your-catalog)** below for how to convert it into the `.json` format the app uses.
	- The `aisleOrder` is the order that you walk through your store. At WinCo, the first section I shop at after entering the store is the Fruit section so it is number 1, Vegetables is number 2, etc. and you could say the last section is the checkout aisle. The value to including this is that the shopping list is built in order of when you will encounter the products in the store. If you buy fruit first it's annoying to have the fruit on the bottom or middle of your shopping list so this is made to simply the list a bit and I find after you do the initial legwork of entering the order it is a very nice feature. 


### AI Usage Costs

Neither of these AI agents are free to use, however, it is very cheap to use this app. I gave both platforms  $5 to start myself out and we're talking a penny or two for each shopping trip at the most. Even though I'm pretty thrifty myself I am happy to pay the cost for the convenience and power of these agents and don't expect to give them anymore money for years to come. I'd suggest just trying it out for yourself and make a nice long list and checking your accounts afterwards to see how much it cost to build. In my case it was less than a penny.


---

## Quick Start


**These are just initial instructions and I will write out a more thorough step-by-step walkthrough later**

### 1. Set up your .env file
```bash
cp .env.example .env
nano .env
```
Fill in your Anthropic and OpenAI API keys.

### 2. Pull and run
```bash
docker compose up -d
```

Open `http://your-server-ip:3006` on your phone.

> **First run note:** if `./data/catalog.json` doesn't exist yet, the container automatically seeds it with the sanitized example catalog (the same one in `catalog-example.xlsx`) so you have something to start editing right away. Once that file exists, it's yours — the container will never overwrite or touch it again on any restart, pull, or update.

---

## GitHub Container Registry

The Docker image is built automatically via GitHub Actions on every push to `main` and published to:
```
ghcr.io/mrjohnnycake/pantry-shopper:latest
```

To pull manually:
```bash
docker pull ghcr.io/mrjohnnycake/pantry-shopper:latest
```


---

## Updating

```bash
docker compose pull
docker compose up -d
```

---

## Configuration

**`.env`** — API keys only, never commit this file:

| Variable | Description |
|---|---|
| `ANTHROPIC_API_KEY` | Your Anthropic API key |
| `OPENAI_API_KEY` | Your OpenAI API key (for Whisper transcription) |

**`docker-compose.yml`** — safe to commit:

| Variable | Description |
|---|---|
| `PORT` | Port to run on (default: 3006) |
| `ANTHROPIC_MODEL` | Claude model to use (default: claude-sonnet-4-6) |

---

## Data Persistence

Your catalog and shopping list are stored in `./data/` on the host, mounted into the container as a volume. Back up this directory to preserve your catalog.

```
data/
  catalog.json   — your product catalog
  list.json      — the current shopping list
```

---

## Hosting

HTTPS is handled by Cloudflare, which is required for microphone access on mobile browsers.

---

## Building Your Catalog

Your catalog lives at `data/catalog.json`. The easiest way to build or update it is in a spreadsheet, then convert it — you have two options:

### Option 1: Conversion script (recommended)

The repo includes `scripts/convert-catalog.js`, which turns a `.xlsx`, `.xls`, or `.csv` file into a properly formatted `catalog.json`.

```bash
# One-time setup — installs the spreadsheet parser (not needed at runtime)
npm install --no-save xlsx

# Convert your spreadsheet
node scripts/convert-catalog.js my-catalog.xlsx
```

This writes to `data/catalog.json` by default. To convert to a different location instead (so you can review before replacing your real catalog):
```bash
node scripts/convert-catalog.js my-catalog.xlsx --out data/catalog-new.json
```

**The script will not overwrite an existing `catalog.json`** — if one already exists at the destination, it stops and tells you to choose a different `--out` path. Once you're happy with the result, rename it or copy it over manually.

Your spreadsheet needs these column headers (case-insensitive, any order): `item`, `store`, `aisle`, `aisleOrder`, `unit`, `stock`, `size`, and optionally `id`. Leave `unit`, `stock`, or `size` blank, or use `?` as a placeholder reminder to fill in later — both are preserved as-is.

### Option 2: Ask an AI to convert it

If you'd rather not run the script, you can give your spreadsheet (or a CSV export of it) to an AI like Claude and ask it to convert it to the catalog JSON structure documented below. This works fine for smaller catalogs but is more prone to small mistakes on large spreadsheets (hundreds of rows) than the script, so double-check the output either way.

---

## Catalog JSON Structure

```json
{
  "stores": [
    { "id": "costco", "name": "Costco" }
  ],
  "items": [
    {
      "id": "canned-corn",
      "item": "Canned Corn",
      "store": "Safeway",
      "aisle": "Canned Goods",
      "aisleOrder": 10,
      "unit": "cans",
      "stock": "6",
      "size": "15 oz"
    }
  ]
}
```

`aisleOrder` controls the sort order within each store — lower numbers appear first. Set it to match the order you physically walk through the store.

`stock` is for how many of the product you like to keep in stock in your pantry and in the shopping list it acts as a reminder when you're at the store. If you think you got your amount to buy count wrong you can see what you're supposed to have and decide how many more to buy