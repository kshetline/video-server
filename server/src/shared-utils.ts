import { LibraryItem } from './shared-types';

export function checksum53(s: string, seed = 0): string {
  let h1 = 0xDEADBEEF ^ seed;
  let h2 = 0x41C6CE57 ^ seed;

  s = s.normalize();

  for (let i = 0, ch: number; i < s.length; ++i) {
    ch = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }

  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);

  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16).toUpperCase().padStart(14, '0');
}

export function hashTitle(title: string): string {
  return title ? checksum53(title.toLowerCase()) : '';
}

function sortForm(s: string): string {
  let $ = /^((A|An|The)\s+)(.*)$/.exec(s);

  if ($)
    s = $[3] + ', ' + $[2];

  $ = /^(\d+)\b(.*)$/.exec(s);

  if ($)
    s = $[1].padStart(8, '0') + $[2];

  return s;
}

const comparator = new Intl.Collator('en', { caseFirst: 'upper' }).compare;

export function librarySorter(a: LibraryItem, b: LibraryItem): number {
  const sa = sortForm(a.name);
  const sb = sortForm(b.name);

  return comparator(sa, sb);
}
