// makefun-x-reposts-02: the entry is the posts on X, not this program.
//
// All this program has to do is copy POSTS.json from the repository root to /output/POSTS.json,
// where the gate reads the list of my posts' addresses. It checks the list first: 1 to 15 items,
// each an x.com/<handle>/status/<id> address (the forms X itself shows are accepted), so a typo
// fails here instead of scoring zero at grading time.

import { copyFileSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const BOT_DIR = process.env.MAKEFUN_BOT_DIR ?? '/bot';
const OUTPUT_DIR = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';
const POSTS_FILE = join(BOT_DIR, 'POSTS.json');

const START = /^https?:\/\/(?:www\.|mobile\.)?(?:x|twitter)\.com\/[A-Za-z0-9_]{1,15}\/status\/\d{5,25}(?:[/?#].*)?$/i;

interface PostsFile {
  posts: string[];
}

function readPosts(): string[] {
  const raw = readFileSync(POSTS_FILE, 'utf8');
  const parsed = JSON.parse(raw) as PostsFile;
  if (!Array.isArray(parsed.posts)) {
    throw new Error('POSTS.json must hold a "posts" array');
  }
  if (parsed.posts.length < 1 || parsed.posts.length > 15) {
    throw new Error('POSTS.json must name 1 to 15 posts, got ' + parsed.posts.length);
  }
  const seen = new Set<string>();
  for (const url of parsed.posts) {
    if (typeof url !== 'string' || !START.test(url)) {
      throw new Error('not a post address: ' + String(url));
    }
    const id = url.replace(/[?#].*$/, '').split('/status/')[1]!;
    if (seen.has(id)) {
      throw new Error('the same post is named twice: ' + url);
    }
    seen.add(id);
  }
  return parsed.posts;
}

const posts = readPosts();
mkdirSync(OUTPUT_DIR, { recursive: true });
copyFileSync(POSTS_FILE, join(OUTPUT_DIR, 'POSTS.json'));
console.log('copied ' + posts.length + ' post address(es) to ' + join(OUTPUT_DIR, 'POSTS.json'));
