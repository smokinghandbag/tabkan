// Unit tests for TabKan's pure helpers (no DOM / chrome needed).
// Run with: node --test scripts/unit.test.mjs   (or `npm run unit`)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  escapeHtml, getFaviconUrl, distanceSq, movedLikeDrag, DRAG_CLICK_THRESHOLD_PX,
  normalizeTag, todoProgress, suggestTags, splitMatch,
} from '../src/utils.js';

test('escapeHtml encodes all five HTML-sensitive characters', () => {
  assert.equal(escapeHtml(`<a href="x" class='y'>&</a>`),
    '&lt;a href=&quot;x&quot; class=&#39;y&#39;&gt;&amp;&lt;/a&gt;');
});

test('escapeHtml handles null/undefined as empty string', () => {
  assert.equal(escapeHtml(null), '');
  assert.equal(escapeHtml(undefined), '');
  assert.equal(escapeHtml(0), '0');
});

test('escapeHtml is injection-safe for a hostile tab title', () => {
  const evil = '"><img src=x onerror=alert(1)>';
  const out = escapeHtml(evil);
  assert.ok(!out.includes('<img'));
  assert.ok(!out.includes('"'));
});

test('getFaviconUrl derives Google favicon service URL from hostname', () => {
  assert.equal(getFaviconUrl('https://news.ycombinator.com/item?id=1'),
    'https://www.google.com/s2/favicons?domain=news.ycombinator.com');
});

test('getFaviconUrl returns inline SVG fallback for an invalid URL', () => {
  const out = getFaviconUrl('not a url');
  assert.ok(out.startsWith('data:image/svg+xml'));
});

test('distanceSq computes squared euclidean distance', () => {
  assert.equal(distanceSq(0, 0, 3, 4), 25);
  assert.equal(distanceSq(1, 1, 1, 1), 0);
});

test('movedLikeDrag: a tiny move (<= threshold) is a click, not a drag', () => {
  // 3px move, threshold 5 → click
  assert.equal(movedLikeDrag(100, 100, 103, 100), false);
  // exactly at threshold → still a click (strictly greater triggers)
  assert.equal(movedLikeDrag(0, 0, DRAG_CLICK_THRESHOLD_PX, 0), false);
});

test('movedLikeDrag: a move beyond threshold is a drag', () => {
  assert.equal(movedLikeDrag(100, 100, 120, 100), true);
  assert.equal(movedLikeDrag(0, 0, DRAG_CLICK_THRESHOLD_PX + 1, 0), true);
});

test('movedLikeDrag: respects a custom threshold', () => {
  assert.equal(movedLikeDrag(0, 0, 8, 0, 10), false);
  assert.equal(movedLikeDrag(0, 0, 12, 0, 10), true);
});

// --- Edit-tab modal helpers ---------------------------------------------

test('normalizeTag strips leading #, trims, collapses whitespace', () => {
  assert.equal(normalizeTag('  #Design  '), 'Design');
  assert.equal(normalizeTag('##job  hunt'), 'job hunt');
  assert.equal(normalizeTag(''), '');
  assert.equal(normalizeTag(null), '');
  assert.equal(normalizeTag(undefined), '');
});

test('todoProgress counts completed / total', () => {
  assert.deepEqual(todoProgress([]), { done: 0, total: 0 });
  assert.deepEqual(todoProgress(undefined), { done: 0, total: 0 });
  assert.deepEqual(
    todoProgress([{ completed: true }, { completed: false }, { completed: true }]),
    { done: 2, total: 3 });
});

test('suggestTags: prefix matches rank before substring matches', () => {
  const all = ['design', 'design-system', 'desk-research', 'redesign'];
  const { matches } = suggestTags(all, 'des', []);
  // prefix hits (design, design-system, desk-research) before substring (redesign)
  assert.deepEqual(matches, ['design', 'design-system', 'desk-research', 'redesign']);
});

test('suggestTags: empty query yields no matches and no create row', () => {
  const r = suggestTags(['a', 'b'], '   ', []);
  assert.deepEqual(r.matches, []);
  assert.equal(r.showCreate, false);
});

test('suggestTags: excludes already-applied tags from matches', () => {
  const { matches } = suggestTags(['design', 'design-system'], 'des', ['design']);
  assert.deepEqual(matches, ['design-system']);
});

test('suggestTags: showCreate is false on an exact existing tag, true otherwise', () => {
  assert.equal(suggestTags(['design'], 'design', []).showCreate, false);   // exact exists
  assert.equal(suggestTags(['design'], '#design', []).showCreate, false);  // exact after normalize
  assert.equal(suggestTags(['design'], 'desi', []).showCreate, true);      // novel
  assert.equal(suggestTags(['design'], 'desi', ['desi']).showCreate, false); // already applied
  assert.equal(suggestTags(['design'], '#new-tag', []).createValue, 'new-tag');
});

test('suggestTags: respects the limit', () => {
  const all = Array.from({ length: 20 }, (_, i) => `tag${i}`);
  assert.equal(suggestTags(all, 'tag', [], 5).matches.length, 5);
});

test('splitMatch: splits around the case-insensitive match for highlighting', () => {
  assert.deepEqual(splitMatch('design-system', 'des'), ['', 'des', 'ign-system']);
  assert.deepEqual(splitMatch('redesign', 'des'), ['re', 'des', 'ign']);
  assert.deepEqual(splitMatch('Design', 'des'), ['', 'Des', 'ign']); // keeps original case
  assert.deepEqual(splitMatch('design', 'xyz'), ['design', '', '']); // no match
  assert.deepEqual(splitMatch('design', ''), ['design', '', '']);    // empty query
});
