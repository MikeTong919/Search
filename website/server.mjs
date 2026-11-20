// Local job-list website. Run:  node website/server.mjs   then open http://localhost:8787
//
// Browsers can't read LinkedIn directly from another site (CORS), so this tiny
// server fetches ONE page of LinkedIn's public, signed-out job search per
// request and returns it as JSON. The web page (index.html) asks for page after
// page, merges them and sorts newest first. No login, cookies or personal data
// are sent to LinkedIn. No dependencies: needs Node 18+.

import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const PORT = Number(process.env.PORT) || 8787;
const HERE = path.dirname(fileURLToPath(import.meta.url));
const FEED = 'https://www.linkedin.com/jobs-guest/jobs/api/seeMoreJobPostings/search';
const DETAIL = 'https://www.linkedin.com/jobs-guest/jobs/api/jobPosting/';
const DETAIL_CACHE_MS = 6 * 3600_000; // a job's description rarely changes
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';
const MIN_GAP_MS = 1500; // never ask LinkedIn more often than this
const CACHE_MS = 20_000; // short, so the per-minute check sees new jobs

let lastFetchAt = 0;
const cache = new Map(); // url -> { at, body }

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const decode = (s) =>
  s.replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;|&#x27;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/\s+/g, ' ').trim();

const decodeAttr = (s) => s.replace(/&amp;/g, '&');

// Keep only simple formatting tags, with no attributes, so the description can
// be shown safely on the page.
const SAFE_TAGS = new Set(['p', 'br', 'ul', 'ol', 'li', 'strong', 'b', 'em', 'i', 'u', 'h2', 'h3', 'h4']);
function cleanHtml(html) {
  return html
    .replace(/<(script|style|iframe|object|template)[\s\S]*?<\/\1>/gi, '')
    .replace(/<\/?([a-z0-9]+)\b[^>]*>/gi, (tag, name) => {
      name = name.toLowerCase();
      if (!SAFE_TAGS.has(name)) return ' ';
      return tag.startsWith('</') ? `</${name}>` : `<${name}>`;
    })
    .replace(/<[^>]*$/, '') // drop any cut-off tag at the end
    .trim();
}

// One job's public detail page: description, industry, seniority, etc.
function parseDetail(html) {
  const criteria = {};
  for (const m of html.matchAll(/description__job-criteria-subheader[^>]*>([\s\S]*?)<\/h3>[\s\S]*?description__job-criteria-text[^>]*>([\s\S]*?)<\/span>/g)) {
    criteria[decode(m[1])] = decode(m[2]);
  }
  const desc = html.match(/show-more-less-html__markup[^>]*>([\s\S]*?)<\/div>/);
  return {
    descriptionHtml: desc ? cleanHtml(desc[1]) : '',
    seniority: criteria['Seniority level'] || '',
    employmentType: criteria['Employment type'] || '',
    jobFunction: criteria['Job function'] || '',
    industry: criteria['Industries'] || '',
    applicants: pick(html, /num-applicants__caption[^>]*>([\s\S]*?)</) || pick(html, /num-applicants__figure[^>]*>([\s\S]*?)</),
    companyUrl: (html.match(/href="(https:\/\/www\.linkedin\.com\/company\/[^"?]+)/) || [])[1] || '',
  };
}

function pick(html, re) {
  const m = html.match(re);
  return m ? decode(m[1]) : '';
}

// Each job is an <li> with a "base-card". Pull out the fields we show.
function parseJobs(html) {
  return html.split(/<li[\s>]/).slice(1).map((c) => {
    const id = (c.match(/jobPosting:(\d+)/) || [])[1];
    if (!id) return null;
    return {
      id,
      title: pick(c, /base-search-card__title[^>]*>([\s\S]*?)<\/h3>/),
      company: pick(c, /base-search-card__subtitle[^>]*>([\s\S]*?)<\/h4>/),
      location: pick(c, /job-search-card__location[^>]*>([\s\S]*?)<\/span>/),
      postedText: pick(c, /<time[^>]*>([\s\S]*?)<\/time>/),
      postedDate: (c.match(/<time[^>]*datetime="([^"]+)"/) || [])[1] || '',
      salary: pick(c, /job-search-card__salary-info[^>]*>([\s\S]*?)<\/span>/),
      logo: decodeAttr((c.match(/<img[^>]*data-delayed-url="([^"]+)"/) || [])[1] || ''),
      companyUrl: (c.match(/href="(https:\/\/www\.linkedin\.com\/company\/[^"?]+)/) || [])[1] || '',
      url: `https://www.linkedin.com/jobs/view/${id}/`,
    };
  }).filter(Boolean);
}

// LinkedIn requests go out one at a time, at least MIN_GAP_MS apart.
let queue = Promise.resolve();
function linkedinGet(url) {
  const run = queue.then(async () => {
    const wait = lastFetchAt + MIN_GAP_MS - Date.now();
    if (wait > 0) await sleep(wait);
    lastFetchAt = Date.now();
    const res = await fetch(url, { headers: { 'User-Agent': UA, 'Accept-Language': 'en-US,en;q=0.9' } });
    return { status: res.status, text: res.status === 200 ? await res.text() : '', at: Date.now() };
  });
  queue = run.catch(() => {});
  return run;
}

const detailCache = new Map(); // id -> { at, body }
async function fetchDetail(id) {
  const hit = detailCache.get(id);
  if (hit && Date.now() - hit.at < DETAIL_CACHE_MS) return { status: 200, ...hit.body };
  const r = await linkedinGet(DETAIL + id);
  if (r.status !== 200) return { status: r.status };
  const body = parseDetail(r.text);
  detailCache.set(id, { at: r.at, body });
  return { status: 200, ...body };
}

async function fetchPage(params) {
  const url = `${FEED}?${params}`;
  const hit = cache.get(url);
  if (hit && Date.now() - hit.at < CACHE_MS) return { status: 200, ...hit.body, cached: true };

  const r = await linkedinGet(url);
  const fetchedAt = r.at;
  if (r.status !== 200) return { status: r.status, jobs: [], fetchedAt };
  const body = { jobs: parseJobs(r.text), fetchedAt };
  cache.set(url, { at: fetchedAt, body });
  return { status: 200, ...body };
}

const ALLOWED = ['keywords', 'location', 'f_TPR', 'f_WT', 'f_E', 'f_JT', 'start'];

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, `http://localhost:${PORT}`);
  try {
    if (u.pathname === '/api/page') {
      const params = new URLSearchParams();
      for (const k of ALLOWED) if (u.searchParams.get(k)) params.set(k, u.searchParams.get(k));
      const out = await fetchPage(params);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(out));
      return;
    }
    if (u.pathname === '/api/job') {
      const id = u.searchParams.get('id') || '';
      if (!/^\d{5,15}$/.test(id)) { res.writeHead(400).end('bad id'); return; }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(await fetchDetail(id)));
      return;
    }
    if (u.pathname === '/' || u.pathname === '/index.html') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(await readFile(path.join(HERE, 'index.html')));
      return;
    }
    res.writeHead(404).end('Not found');
  } catch (err) {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 500, error: String(err.message || err), jobs: [] }));
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`Job list running at http://localhost:${PORT}`);
});
