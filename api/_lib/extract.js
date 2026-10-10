// Turn an HTML page into a title, a word count and a reading-time estimate.
// No dependencies: a careful regex pass is enough for word counting, and it
// keeps the serverless function small and fast to cold-start.

/** Average silent reading speed for non-fiction (Brysbaert, 2019). */
export const WORDS_PER_MINUTE = 238;
/** Extra seconds per image, the way most blogs count it (capped). */
const SECONDS_PER_IMAGE = 10;
const MAX_IMAGE_SECONDS = 120;
/** Below this many words we treat the page as rendered by JavaScript. */
export const MIN_RELIABLE_WORDS = 150;

const ENTITY = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", mdash: "—", ndash: "–", hellip: "…", rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“", copy: "©", reg: "®", trade: "™" };

export function decodeEntities(s) {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    if (e[0] === "#") {
      const code = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : " ";
    }
    return ENTITY[e.toLowerCase()] ?? m;
  });
}

const clean = (s) => decodeEntities(s).replace(/\s+/g, " ").trim();

function metaContent(html, attr, name) {
  // handles either attribute order: <meta property="og:title" content="..."> or reversed
  const re1 = new RegExp(`<meta[^>]+${attr}\\s*=\\s*["']${name}["'][^>]*content\\s*=\\s*(["'])([\\s\\S]*?)\\1`, "i");
  const re2 = new RegExp(`<meta[^>]+content\\s*=\\s*(["'])([\\s\\S]*?)\\1[^>]*${attr}\\s*=\\s*["']${name}["']`, "i");
  const m = html.match(re1) || html.match(re2);
  return m ? clean(m[2]) : "";
}

export function extractTitle(html) {
  const og = metaContent(html, "property", "og:title") || metaContent(html, "name", "twitter:title");
  if (og) return og.slice(0, 200);
  const t = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (t) return clean(t[1]).slice(0, 200);
  const h1 = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
  return h1 ? clean(stripTags(h1[1])).slice(0, 200) : "";
}

export function extractSiteName(html, hostname) {
  return (metaContent(html, "property", "og:site_name") || hostname.replace(/^www\./, "")).slice(0, 80);
}

/** wordCount declared in JSON-LD (Article/BlogPosting), if the publisher gives one. */
export function jsonLdWordCount(html) {
  const blocks = html.match(/<script[^>]+application\/ld\+json[^>]*>[\s\S]*?<\/script>/gi) || [];
  for (const b of blocks) {
    const m = b.match(/"wordCount"\s*:\s*"?(\d{2,6})"?/);
    if (m) return Number(m[1]);
  }
  return null;
}

function stripTags(s) {
  return s.replace(/<[^>]+>/g, " ");
}

function removeBlocks(html, tags) {
  let out = html;
  for (const tag of tags) out = out.replace(new RegExp(`<${tag}\\b[\\s\\S]*?<\\/${tag}>`, "gi"), " ");
  return out;
}

/** Pick the part of the page that holds the article itself. */
export function mainContent(html) {
  let h = html.replace(/<!--[\s\S]*?-->/g, " ");
  h = removeBlocks(h, ["script", "style", "noscript", "template", "svg", "head", "iframe", "select"]);
  const articles = [...h.matchAll(/<article\b[^>]*>([\s\S]*?)<\/article>/gi)].map((m) => m[1]);
  let region;
  if (articles.length) region = articles.reduce((a, b) => (b.length > a.length ? b : a));
  else {
    const main = h.match(/<main\b[^>]*>([\s\S]*?)<\/main>/i);
    if (main) region = main[1];
    else {
      const body = h.match(/<body\b[^>]*>([\s\S]*)<\/body>/i);
      region = body ? body[1] : h;
    }
  }
  return removeBlocks(region, ["nav", "header", "footer", "aside", "form", "button", "figcaption"]);
}

const segmenter = typeof Intl !== "undefined" && Intl.Segmenter ? new Intl.Segmenter(undefined, { granularity: "word" }) : null;

/** Count words in plain text. Uses Intl.Segmenter so Amharic, CJK and Arabic count sensibly. */
export function countWords(text) {
  if (!text) return 0;
  if (segmenter) {
    let n = 0;
    for (const seg of segmenter.segment(text)) if (seg.isWordLike) n++;
    return n;
  }
  return (text.match(/[\p{L}\p{N}][\p{L}\p{N}'’_-]*/gu) || []).length;
}

export function countImages(regionHtml) {
  return (regionHtml.match(/<img\b/gi) || []).length;
}

/** Reading minutes from words and images; never below 1. */
export function readingMinutes(words, images = 0) {
  const imgSeconds = Math.min(MAX_IMAGE_SECONDS, images * SECONDS_PER_IMAGE);
  return Math.max(1, Math.round(words / WORDS_PER_MINUTE + imgSeconds / 60));
}

/**
 * Full analysis of an HTML document.
 * confidence: "high" when we read enough real text, "low" when the page is
 * mostly empty in HTML (built by JavaScript, paywalled, or a login page).
 */
export function analyzeHtml(html, hostname = "") {
  const title = extractTitle(html);
  const siteName = extractSiteName(html, hostname);
  const region = mainContent(html);
  const text = clean(stripTags(region));
  const counted = countWords(text);
  const declared = jsonLdWordCount(html);
  // Trust a publisher's declared count when our count is clearly truncated.
  const words = declared && declared > counted * 1.25 ? declared : counted;
  const images = countImages(region);
  if (words < MIN_RELIABLE_WORDS) {
    return { title, siteName, words, minutes: null, confidence: "low" };
  }
  return { title, siteName, words, minutes: readingMinutes(words, images), confidence: "high" };
}
