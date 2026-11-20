# Recent Remote Jobs for LinkedIn

This project has two tools:

- **[Website](#website-newest-jobs-list)** ("Job Radar"): a page on your Mac that pulls LinkedIn's public job listings into one feed, strictly newest first, with remote detection, resume match scores and Like / Applied / Not interested lists. No account or login, nothing to install in Chrome.
- **[Chrome extension](#chrome-extension)**: works inside LinkedIn itself while you're signed in.

## Website: newest jobs list

Needs [Node.js](https://nodejs.org) 18 or newer (check with `node -v`).

```bash
node website/server.mjs
```

Then open http://localhost:8787, set keywords, location and "Posted within" (15 minutes to a week), and press **Search**. The page loads every page of results, merges them and sorts **newest first**.

- **Layout.** A sidebar with **Recommended**, **Liked**, **Applied** and **Not interested**, plus **Resume**. The main area is a feed of job cards: posted time, title, company and industry, location, work model, job type, experience level, years asked, salary, applicants and tags, with a match ring and **♡ Like**, **⊘ Not interested** and **Apply ↗** buttons on the right. Clicking a card slides in the full job: header and buttons, **How well you match**, work model and sponsorship (with the sentence they came from), the description, and the company. Esc or clicking outside closes it. On a phone, the sidebar becomes a row of tabs and the job opens full screen.
- **Apply tracking.** After you click **Apply** and come back to the page, it asks "Did you apply to …?" and moves the job to **Applied** if you say yes.
- **Liked, Applied, Not interested** stay in your browser, even after the job drops out of the search. Not-interested jobs leave the main feed.
- **Filters.** Industry (built from the jobs loaded so far, with counts), experience level, job type, applicants (under 25 / 50 / 100), salary listed, and **Exclude words** (also searches the industry and description, so `clearance` or `staffing` work). Industry, seniority, type and applicant filters need each job's details, which load in the background, newest jobs first, about one every 1.5 seconds. The status line shows how many have loaded.
- **New jobs every minute** (on by default). Once a minute the page asks LinkedIn only for jobs posted since the last check, usually one request, and adds them at the top with a **NEW** badge. The browser tab title shows how many are new, for example **(3) Job Radar**. Jobs older than your "Posted within" choice drop off.
- **Remote only** (the default **Work model** setting). LinkedIn's public listings have no remote/on-site field and ignore LinkedIn's own remote filter, so the site reads each job: the title first ("Remote", "WFH", "Onsite"), then the description ("fully remote", "Location: Remote" versus "3 days a week in the office", "on-site required"), then a country-only location like "United States". Explicit on-site or hybrid wording wins over a passing mention of remote. Each job shows a **Remote / Hybrid / On-site** tag, and the detail panel shows the sentence it was based on. A job appears once its description has been read. **Remote + unclear** also shows jobs that don't say either way, and **Any** shows everything.
- **Match score.** Click **Resume** in the sidebar and upload a PDF or text file, or paste your resume, plus your years of experience. Each job then gets a match % made of three parts: **Skills** (share of the skills the job mentions that are on your resume, 60%), **Experience** (your years against the years it asks for, 25%) and **Job title** (how much of the title appears on your resume, 15%). The job view shows each part as a bar, plus the skills you have ✓ and are missing ✗. **Sort → Best match** puts the best fits first, and **Match → 70%+** hides weaker ones. Your resume stays in this browser and is never sent anywhere. Reading a PDF loads the open-source pdf.js library from cdnjs.
- **Sponsorship, experience and early-applicant tags.** Read from each description: **No sponsorship**, **US citizen / clearance** or **Sponsors visas** (the detail panel quotes the sentence), **5+ yrs** for the experience asked for, and **Early applicant** when there are under 25 applicants. **H1B / visa → Hide "no sponsorship" & clearance** removes jobs that won't sponsor.
- **Employee count** isn't on LinkedIn's public pages (company pages block signed-out visitors), so the company name links to its LinkedIn page, where you can see the size while signed in.

Stop the server with Ctrl+C.

How it works: browsers can't read LinkedIn from another site, so `website/server.mjs` fetches one page of LinkedIn's public (signed-out) job search at a time and passes it to the page. It waits at least 1.5 seconds between requests, and if LinkedIn says "too many requests" the page waits and retries.

Limits:
- Remote detection reads the job's own wording. In a check against LinkedIn's signed-in labels, all 9 jobs it marked remote really were remote, but it missed some remote jobs whose descriptions don't mention it (those show under **Remote + unclear**).
- LinkedIn only gives "x minutes/hours ago", so jobs posted in the same minute or hour are in no particular order.
- LinkedIn's newest public listings are sometimes 15–20 minutes behind, so a "15 minutes" search can come back empty. The page tells you when that happens.
- LinkedIn limits how fast its public search can be read. A big search (24 hours or a week) takes a few minutes and may stop early. Shorter windows like 1 hour are quick.
- LinkedIn's terms don't allow automated collection of its data, and it can block your internet address for a while if it's used heavily. Keep this for personal use on your own Mac, with modest searches.

## Chrome extension

A Chrome extension (Chrome, Brave, Edge or Arc on Mac or Windows) that keeps LinkedIn on its **classic job search** and lists jobs **strictly newest first**. If job A was posted after job B, A is listed above B.

## How it works

LinkedIn now redirects job searches to its AI search, which has no "Most recent" sort and ignores most filters. Adding `skipRedirect=true` to the address keeps the classic search. This is the same idea as the "LinkedIn Skip Redirect" extension.

- **Classic search, always.** Built-in redirect rules (`extension/rules.json`) add `skipRedirect=true` to every LinkedIn job search and send AI-search addresses (`/jobs/search-results/`) to the classic page. Addresses that already have `skipRedirect=true` are left alone, so there's no redirect loop.
- **Really recent jobs.** The classic page accepts any posted-within window, so **15 min, 1 hr, 3 hr…** in the popup are real LinkedIn filters (the AI search's shortest is 24 hours).
- **Newest first.** Even the classic page returns jobs in mixed order and spreads new jobs across all pages. So the extension:
  - fills in every card on the page (LinkedIn only loads the ones near the screen), then sorts the page **once**, newest at the top;
  - after **Search newest jobs**, scans every results page automatically and opens one list of **all** jobs, newest first. Click **Stop** to finish early. On any search you can reopen it with the blue **Newest-first list** button.
- **Working page buttons.** On the classic page, LinkedIn's own page buttons (1, 2, 3, Next) load "No matching jobs found". The extension turns them into normal page loads, which work.
- **Easy Apply fix** (`extension/classic-fixes.js`, taken unchanged from "LinkedIn Skip Redirect"). After you submit or close an Easy Apply dialog, LinkedIn reloads the classic page to an empty list. This blocks that reload and keeps your results on screen.
- **Remote only.** LinkedIn ignores its remote filter, so "remote" is added to your search text and any non-remote job that slips through is hidden.
- **Hides** Promoted jobs, jobs you applied to, viewed jobs (off by default), jobs older than your window, and jobs containing words you list (for example `clearance, staff, Revature`). Tick **Show hidden jobs** in the list to see them again.
- **Viewed jobs.** LinkedIn hides the posted time on jobs you've viewed. The extension remembers each job's time when it sees it, and reads it from the job details when you click a job.

Settings save automatically. Remembered job times stay in your browser for 30 days.

## Install (about 1 minute)

1. Open Chrome and go to `chrome://extensions`
2. Turn on **Developer mode** (top-right switch)
3. Click **Load unpacked** and choose the `extension` folder in this project (the folder that contains `manifest.json`)
4. Click the puzzle-piece icon in the toolbar and **pin** "Recent Remote Jobs"
5. Make sure you're signed in to LinkedIn, then click the icon and press **Search newest jobs**

Use only one of the two extensions: turn off "LinkedIn Skip Redirect" if you have it installed, because this extension already does the same redirect.

After you change any code, click the ↻ reload button on the extension's card in `chrome://extensions`, then refresh LinkedIn.

If Chrome says `Cannot load extension with file or directory name _metadata`, delete the `_metadata` folder inside `extension` (Chrome creates it on another computer; it must not be copied between machines).

## Limits

- LinkedIn shows "x minutes/hours ago", not exact times. Jobs posted in the same minute or hour are ordered as precisely as the extension can narrow them down.
- LinkedIn says it is "gradually retiring classic job search". If the classic page disappears for your account, the extension still sorts the AI search, but that page only supports 24-hour, week and month windows.
- LinkedIn changes its pages often. If sorting stops working, the card selector in `extension/content.js` (`CARD_SEL`) probably needs updating.
