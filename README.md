# Recent Remote Jobs for LinkedIn

A Chrome extension (works in Chrome, Brave, Edge, Arc on Mac) that skips LinkedIn's AI job search and opens the **classic job search, sorted by newest first**, with your filters already set.

## What it does

- **One-click search**: click the toolbar icon, then **Search newest jobs**. It opens LinkedIn's classic search with:
  - Sort: **Most recent** (`sortBy=DD`)
  - Work type: **Remote** (`f_WT=2`)
  - Posted within: 15 min, 1 hr, 3 hr, 6 hr, 12 hr, 24 hr, 3 days, week, or any (`f_TPR`). The 15 min to 12 hr options aren't in LinkedIn's own menu.
  - Optional: experience level, job type, Easy Apply only
- **Skips the AI search**: if LinkedIn sends you to its AI search page (`/jobs/search-results/`), the extension switches you to the classic search, keeping your keywords.
- **Cleans up the results list**: hides *Promoted* jobs, jobs you already applied to, jobs you already viewed (off by default), and any job containing words you list (for example `clearance, staff, Revature`). A blue pill in the bottom-left shows how many jobs were hidden. Click it to show them again.

Your settings save automatically and sync through your Chrome profile.

## Install (about 1 minute)

1. Open Chrome and go to `chrome://extensions`
2. Turn on **Developer mode** (top-right switch)
3. Click **Load unpacked** and choose the `extension` folder in this project
4. Click the puzzle-piece icon in the toolbar and **pin** "Recent Remote Jobs"
5. Make sure you're signed in to LinkedIn, then click the icon and press **Search newest jobs**

After you change any code, click the ↻ reload button on the extension's card in `chrome://extensions`.

## Keyword tips

The classic search supports boolean operators:

```
("software engineer" OR "backend engineer" OR "full stack") NOT (senior OR staff OR principal)
```

## Safari

Safari needs extensions converted with Xcode (`xcrun safari-web-extension-converter extension/`). Using Chrome is the easiest option.

## Note

LinkedIn changes its page layout often. If jobs stop being hidden, the page structure probably changed, and the selectors in `extension/content.js` (`CARD_SELECTOR`) will need updating. The search URL parameters are less likely to change.
