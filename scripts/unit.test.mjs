// Unit tests for TabKan's pure helpers (no DOM / chrome needed).
// Run with: node --test scripts/unit.test.mjs   (or `npm run unit`)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  escapeHtml, getFaviconUrl, distanceSq, movedLikeDrag, DRAG_CLICK_THRESHOLD_PX,
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
