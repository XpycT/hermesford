/**
 * gettext PO files for the translators' worklist (docs/specs/I18N.md §4.7, `tools/i18n-worklist.mjs
 * --format=po`): what CAT tools and translation platforms read and write. One entry per unit or term:
 *
 *     #. speaker: Elder Maren
 *     #. before: Ah, a traveler.
 *     #. previous translation: 古い訳
 *     #. where: levels/emberfall.json › elder (npc) › dialogue[1]
 *     #: levels/emberfall.json:9F2A1B3C4D5E6F708192A3B4C5D6E7F8
 *     #, fuzzy
 *     #| msgid "The old English"
 *     msgctxt "9F2A1B3C4D5E6F708192A3B4C5D6E7F8"
 *     msgid "The English"
 *     msgstr ""
 *
 * `msgctxt` is the unit's key — the text key the data holds beside the text, a GUID (I18N.md
 * §4.2), or a code key such as `dlg.elder.welcome` — (`term` for a term), `msgid` the English,
 * `msgstr` the translation; `#.` notes for the translator (the readable place among them: the key
 * names no place), `#:` where the text is used as
 * `<file>:<key>` or `<file>:<line>` (no white space: gettext tools split references on it), `#, fuzzy`
 * with `#| msgid` for a unit whose English changed (its `msgstr` empty: the old translation, in a
 * note, is no translation of the new English). The header names the language and the table
 * (`X-Luminati-Table`) and has the fields `msgfmt --check` asks for.
 *
 * Strings are escaped as gettext writes them (`\\`, `\"`, `\n`, `\t`, `\r`, `\a`, `\b`, `\f`, `\v`);
 * a string with line breaks is written over several lines after an empty first one. The parser reads
 * those and the other C escapes (octal `\NNN`, hex `\xHH`, `\'`, `\?`), continuation lines, every
 * comment kind, and skips obsolete `#~` entries; U+2028 and U+2029 stay as they are inside a string
 * (lines end only at LF, CR LF or CR). Plural forms are not used here: an entry with
 * `msgid_plural` or `msgstr[n]` is reported and skipped. Node-safe, import-free.
 */

/**
 * One PO entry.
 * @typedef {object} PoEntry
 * @property {string|null} msgctxt
 * @property {string} msgid
 * @property {string} msgstr
 * @property {string[]} extracted   `#.` lines
 * @property {string[]} references  `#:` lines
 * @property {string[]} flags       `#,` flags (`fuzzy` …)
 * @property {string[]} comments    `# ` translator comments
 * @property {{ msgctxt?: string, msgid?: string }} previous   `#|` fields
 * @property {number} line          where the entry starts in the file (1-based; parsed entries)
 */

/** @type {Record<string, string>} */
const ESC = { '\\': '\\\\', '"': '\\"', '\n': '\\n', '\t': '\\t', '\r': '\\r', '\x07': '\\a', '\b': '\\b', '\f': '\\f', '\v': '\\v' };

/**
 * A string's PO escape (no quotes around it).
 * @param {string} s
 */
export function poEscape(s) {
  return String(s).replace(/[\\"\n\t\r\x07\b\f\v]/g, (c) => ESC[c]);
}

/**
 * `keyword "…"`: one line, or — when the text has line breaks — an empty first line and one line per
 * piece ending in `\n`, as gettext writes it.
 * @param {string} keyword
 * @param {string} s
 * @param {string} [prefix] `#| ` for a previous field
 */
export function poString(keyword, s, prefix = '') {
  const text = String(s);
  const pieces = text.split(/(?<=\n)/);
  if (pieces.length <= 1) return `${prefix}${keyword} "${poEscape(text)}"`;
  return [`${prefix}${keyword} ""`, ...pieces.filter((p) => p !== '').map((p) => `${prefix}"${poEscape(p)}"`)].join('\n');
}

/**
 * A comment's text on one line (a line break inside it would end the comment).
 * @param {string} s
 */
const oneLine = (s) => String(s).replace(/\r\n?|\n/g, '⏎');

/**
 * The text of a PO file: the header (`fields`, in order, after the standard ones), then each entry.
 * @param {{ fields: Record<string, string>, comments?: string[], entries: Partial<PoEntry>[] }} po
 */
export function serializePo(po) {
  const header = { 'Project-Id-Version': 'Luminati content', 'MIME-Version': '1.0', 'Content-Type': 'text/plain; charset=UTF-8', 'Content-Transfer-Encoding': '8bit', ...po.fields };
  const out = [];
  for (const c of po.comments ?? []) out.push(`# ${oneLine(c)}`);
  out.push('msgid ""', poString('msgstr', Object.entries(header).map(([k, v]) => `${k}: ${oneLine(v)}\n`).join('')));
  for (const e of po.entries) {
    const lines = [''];
    for (const c of e.comments ?? []) lines.push(`# ${oneLine(c)}`);
    for (const c of e.extracted ?? []) lines.push(`#. ${oneLine(c)}`);
    for (const c of e.references ?? []) lines.push(`#: ${oneLine(c)}`);
    if (e.flags?.length) lines.push(`#, ${e.flags.join(', ')}`);
    if (e.previous?.msgctxt !== undefined) lines.push(poString('msgctxt', e.previous.msgctxt, '#| '));
    if (e.previous?.msgid !== undefined) lines.push(poString('msgid', e.previous.msgid, '#| '));
    if (e.msgctxt !== null && e.msgctxt !== undefined) lines.push(poString('msgctxt', e.msgctxt));
    lines.push(poString('msgid', e.msgid ?? ''), poString('msgstr', e.msgstr ?? ''));
    out.push(...lines);
  }
  return `${out.join('\n')}\n`;
}

/**
 * A quoted PO string's value (`"…"` → the text), or null when it is no quoted string.
 * @param {string} s the part after the keyword, trimmed
 */
function unquote(s) {
  if (s.length < 2 || s[0] !== '"' || s[s.length - 1] !== '"') return null;
  const body = s.slice(1, -1);
  let out = '';
  for (let i = 0; i < body.length; i++) {
    const c = body[i];
    if (c === '"') return null;
    if (c !== '\\') { out += c; continue; }
    const n = body[++i];
    if (n === undefined) return null;
    switch (n) {
      case 'n': out += '\n'; break;
      case 't': out += '\t'; break;
      case 'r': out += '\r'; break;
      case 'a': out += '\x07'; break;
      case 'b': out += '\b'; break;
      case 'f': out += '\f'; break;
      case 'v': out += '\v'; break;
      case '\\': case '"': case '\'': case '?': out += n; break;
      case 'x': {
        const m = /^[0-9a-fA-F]+/.exec(body.slice(i + 1));
        if (!m) return null;
        out += String.fromCharCode(parseInt(m[0].slice(-2), 16));
        i += m[0].length;
        break;
      }
      default: {
        const m = /^[0-7]{1,3}/.exec(body.slice(i));
        if (!m) return null;
        out += String.fromCharCode(parseInt(m[0], 8));
        i += m[0].length - 1;
      }
    }
  }
  return out;
}

/**
 * The header's fields (`Language: ja\n…`).
 * @param {string} msgstr
 * @returns {Record<string, string>}
 */
export function poHeader(msgstr) {
  /** @type {Record<string, string>} */
  const out = Object.create(null);
  for (const line of msgstr.split('\n')) {
    const at = line.indexOf(':');
    if (at > 0) out[line.slice(0, at).trim()] = line.slice(at + 1).trim();
  }
  return out;
}

/**
 * Parse a PO file: its header fields, its entries (the header entry — `msgid ""` with no context —
 * not among them) and the problems (`errors`: a line that is no PO, a string that is not closed, a
 * plural entry …; those entries are left out). Never throws.
 * @param {string} text
 * @returns {{ header: Record<string, string>, entries: PoEntry[], errors: { line: number, msg: string }[] }}
 */
export function parsePo(text) {
  /** @type {PoEntry[]} */
  const entries = [];
  /** @type {{ line: number, msg: string }[]} */
  const errors = [];
  /** @type {Record<string, string>} */
  let header = Object.create(null);
  const lines = String(text).replace(/^﻿/, '').split(/\r\n?|\n/);
  /** @returns {PoEntry & { _plural: boolean, _seen: Set<string>, _bad: boolean }} */
  const fresh = (line) => ({ msgctxt: null, msgid: '', msgstr: '', extracted: [], references: [], flags: [], comments: [], previous: {}, line, _plural: false, _seen: new Set(), _bad: false });
  let cur = fresh(1);
  /** the field continuation lines append to: [entry part, field] */
  let field = /** @type {null | { prev: boolean, name: string }} */ (null);
  let started = false;
  const finish = () => {
    if (started) {
      if (cur._plural) errors.push({ line: cur.line, msg: 'a plural entry (msgid_plural / msgstr[n]) — plural forms are not used here: skipped' });
      else if (!cur._seen.has('msgid')) errors.push({ line: cur.line, msg: 'an entry without msgid: skipped' });
      else if (!cur._bad) {
        if (cur.msgid === '' && cur.msgctxt === null) header = poHeader(cur.msgstr);
        else {
          const { _plural, _seen, _bad, ...e } = cur;
          entries.push(e);
        }
      }
    }
    started = false;
    field = null;
  };
  /** @param {boolean} prev a `#|` field @param {string} name @param {string} value */
  const set = (prev, name, value) => {
    if (prev) {
      const k = name === 'msgctxt' ? 'msgctxt' : 'msgid';
      cur.previous[k] = (cur.previous[k] ?? '') + value;
    } else if (name === 'msgctxt') cur.msgctxt = (cur.msgctxt ?? '') + value;
    else if (name === 'msgid') cur.msgid += value;
    else if (name === 'msgstr') cur.msgstr += value;
  };
  for (let n = 0; n < lines.length; n++) {
    const raw = lines[n];
    const line = raw.trim();
    const at = n + 1;
    if (!line) { if (started) finish(); continue; }
    if (line.startsWith('#~')) { if (started) finish(); continue; }
    if (line.startsWith('#')) {
      // a comment after a keyword starts the next entry
      if (started && cur._seen.has('msgid')) finish();
      if (!started) { cur = fresh(at); started = true; }
      const kind = line[1];
      const body = line.slice(2).trim();
      if (kind === '.') cur.extracted.push(body);
      else if (kind === ':') cur.references.push(body);
      else if (kind === ',') cur.flags.push(...body.split(',').map((f) => f.trim()).filter(Boolean));
      else if (kind === '|') {
        // (`s`: a string may hold U+2028 / U+2029, which `.` does not match otherwise)
        const m = /^(msgctxt|msgid)\s+(.*)$/s.exec(body);
        if (m) {
          const v = unquote(m[2].trim());
          if (v === null) errors.push({ line: at, msg: `#| ${m[1]}: not a quoted string` });
          else { set(true, m[1], v); field = { prev: true, name: m[1] }; }
        } else if (body.startsWith('"')) {
          const v = unquote(body);
          if (v === null || !field?.prev) errors.push({ line: at, msg: '#| a string that continues nothing' });
          else set(true, field.name, v);
        }
      } else cur.comments.push(line.slice(1).trim());
      continue;
    }
    const m = /^(msgctxt|msgid_plural|msgid|msgstr(?:\[\d+\])?)\s+(.*)$/s.exec(line);
    if (m) {
      const kw = m[1];
      // a new msgctxt / msgid after a msgstr starts the next entry
      if (started && (kw === 'msgctxt' || kw === 'msgid') && cur._seen.has('msgstr')) finish();
      if (!started) { cur = fresh(at); started = true; }
      if (kw === 'msgid_plural' || kw.startsWith('msgstr[')) { cur._plural = true; field = null; continue; }
      const v = unquote(m[2].trim());
      if (v === null) { errors.push({ line: at, msg: `${kw}: not a quoted string` }); cur._bad = true; field = null; continue; }
      if (cur._seen.has(kw)) { errors.push({ line: at, msg: `${kw} twice in one entry` }); cur._bad = true; }
      cur._seen.add(kw);
      set(false, kw, v);
      field = { prev: false, name: kw };
      continue;
    }
    if (line.startsWith('"')) {
      if (started && cur._plural) continue;
      const v = unquote(line);
      if (v === null) { errors.push({ line: at, msg: 'not a quoted string' }); cur._bad = true; continue; }
      if (!field || field.prev) { errors.push({ line: at, msg: 'a string that continues nothing' }); continue; }
      set(false, field.name, v);
      continue;
    }
    errors.push({ line: at, msg: `not a PO line: ${line.length > 40 ? `${line.slice(0, 39)}…` : line}` });
  }
  finish();
  return { header, entries, errors };
}
