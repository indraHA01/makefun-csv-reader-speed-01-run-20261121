// csv-reader-speed: a faster drop-in for csv-reader 1.0.0.
//
// The reading is exactly csv-reader 1.0.0's — same {columns, rows, errors},
// same broken-row policy, same error order and line numbers — but the text
// is never walked one character at a time. Two ideas do the work:
//
//   1. A clean record (no quote, no stray CR on its line) is split whole:
//      one slice and one native String.split(',') instead of a per-field
//      scan. A quarter of a drawn set's records are clean; the rest take
//      the field-by-field road below.
//   2. Anything else is located with indexOf jumps and sliced: an unquoted
//      field ends at the nearest comma or LF, a quoted field at the nearest
//      quote, doubled quotes and stray CRs handled only when they appear.
//
// Quoted segments that hold no line break are a plain slice; only a segment
// with a CR or LF inside takes the slow road that turns CRLF and lone CR
// into LF and counts the lines. No dependencies, no state kept between
// calls, nothing cached from one case to the next.

/** csv-reader 1.0.0's answer for one case's input {text, header}. */
export function run(input) {
  const text = String(input.text);
  const header = input.header === true;
  const len = text.length;
  const errors = [];
  const rows = [];
  let columns = null;
  let width = -1;
  let pos = text.charCodeAt(0) === 0xFEFF ? 1 : 0;
  let line = 1;
  // The record being read: the line it starts on, and its index in rows
  // (null while the header is being read). Field errors use these.
  let recLine = 1;
  let recRow = null;

  // The slice text[a..b) of a quoted field, with every CRLF or lone CR
  // inside it read as one LF (and counted as a line), as csv-reader does.
  // The common segment holds no line break at all and is just a slice.
  function qseg(a, b) {
    const n = text.indexOf('\n', a);
    if (n !== -1 && n < b) return qsegSlow(a, b);
    const r = text.indexOf('\r', a);
    if (r !== -1 && r < b) return qsegSlow(a, b);
    return text.slice(a, b);
  }

  // A quoted segment that holds a line break: join its pieces with LF,
  // counting one line per break (a CRLF counts once, not twice).
  function qsegSlow(a, b) {
    const parts = [];
    let s = a;
    for (;;) {
      let n = text.indexOf('\n', s);
      if (n === -1 || n >= b) n = -1;
      let r = text.indexOf('\r', s);
      if (r === -1 || r >= b) r = -1;
      const m = n === -1 ? r : r === -1 ? n : n < r ? n : r;
      if (m === -1) {
        parts.push(text.slice(s, b));
        break;
      }
      parts.push(text.slice(s, m));
      line += 1;
      s = text.charCodeAt(m) === 13 && text.charCodeAt(m + 1) === 10 ? m + 2 : m + 1;
    }
    return parts.join('\n');
  }

  // Reads an unquoted field starting at pos, onto `head` ('' for a plain
  // field, a quoted field's value for the junk after its closing quote).
  // It writes its answer into uqValue/uqEnded/uqAdded instead of returning
  // an object, so a field costs no allocation: uqEnded 0 at a comma, 1 at
  // a line break, 2 at the end of the text; uqAdded counts the characters
  // kept, so a stray CR dropped on the way does not count. A CR not
  // followed by LF is dropped with a stray_cr error; a CRLF ends the field.
  // One sticky-free regex scan finds the next comma, LF or CR in a single
  // native pass, where three indexOf calls would each rescan the field.
  let uqValue = '';
  let uqEnded = 2;
  let uqAdded = 0;
  const SEP = /[,\n\r]/g;
  function readUnquoted(head) {
    let value = head;
    for (;;) {
      SEP.lastIndex = pos;
      const m = SEP.exec(text);
      if (m === null) {
        value += text.slice(pos);
        pos = len;
        uqValue = value;
        uqAdded = value.length - head.length;
        uqEnded = 2;
        return;
      }
      const i = m.index;
      const ch = text.charCodeAt(i);
      if (ch === 44) {
        value += text.slice(pos, i);
        pos = i + 1;
        uqValue = value;
        uqAdded = value.length - head.length;
        uqEnded = 0;
        return;
      }
      if (ch === 10) {
        value += text.slice(pos, i);
        pos = i + 1;
        line += 1;
        uqValue = value;
        uqAdded = value.length - head.length;
        uqEnded = 1;
        return;
      }
      if (text.charCodeAt(i + 1) === 10) {
        value += text.slice(pos, i);
        pos = i + 2;
        line += 1;
        uqValue = value;
        uqAdded = value.length - head.length;
        uqEnded = 1;
        return;
      }
      // A stray CR: dropped, its error recorded, and the field reads on.
      value += text.slice(pos, i);
      errors.push({ code: 'stray_cr', line: recLine, row: recRow });
      pos = i + 1;
    }
  }

  // Finishes a record: the first record sets the width (and is the header
  // when header is true); later ones are padded (short_row) or cut
  // (long_row) to it, the error recorded when the record ends.
  function finishRecord(fields) {
    if (width < 0) width = fields.length;
    if (header && columns === null) {
      columns = fields;
      return;
    }
    if (fields.length < width) {
      errors.push({ code: 'short_row', line: recLine, row: recRow, fields: fields.length });
      while (fields.length < width) fields.push('');
    } else if (fields.length > width) {
      errors.push({ code: 'long_row', line: recLine, row: recRow, extra: fields.splice(width) });
    }
    rows.push(fields);
  }

  while (pos < len) {
    // Lines with no characters are no records.
    const c = text.charCodeAt(pos);
    if (c === 10) {
      pos += 1;
      line += 1;
      continue;
    }
    if (c === 13 && text.charCodeAt(pos + 1) === 10) {
      pos += 2;
      line += 1;
      continue;
    }

    recLine = line;
    recRow = header && columns === null ? null : rows.length;

    // Fast path: this record's line holds no quote and no stray CR, so the
    // whole line is its fields. A CR may only sit at the very end of the
    // line, where it is the CRLF that ends the record.
    const lf = text.indexOf('\n', pos);
    const lineEnd = lf === -1 ? len : lf;
    const q = text.indexOf('"', pos);
    if (q === -1 || q >= lineEnd) {
      let s = text.slice(pos, lineEnd);
      const r = s.indexOf('\r');
      // A CR at the very end of the line is the CRLF that ends the record —
      // but only when a LF follows it. A CR left at the end of the text is
      // a stray CR, not a line break: that line takes the slow path.
      if (r === -1 || (r === s.length - 1 && lf !== -1)) {
        if (r !== -1) s = s.slice(0, -1);
        if (s === '') {
          // An empty line: no record.
          pos = lf + 1;
          line += 1;
          continue;
        }
        const fields = s.split(',');
        pos = lf === -1 ? len : lf + 1;
        line += 1;
        finishRecord(fields);
        continue;
      }
    }

    // Slow path: the record holds a quote or a stray CR. Parse it field by
    // field, still jumping with indexOf instead of walking characters.
    const fields = [];
    let quoted = false;
    let ended = 2;
    do {
      quoted = text.charCodeAt(pos) === 34;
      let value;
      if (quoted) {
        const open = pos;
        const openLine = line;
        let start = pos + 1;
        let p = start;
        let chunks = null;
        let closed = false;
        value = '';
        for (;;) {
          const qq = text.indexOf('"', p);
          if (qq === -1) break;
          if (text.charCodeAt(qq + 1) === 34) {
            // A doubled quote: one quote in the value, and the field reads on.
            const seg = qseg(start, qq);
            if (chunks === null) chunks = [seg, '"'];
            else chunks.push(seg, '"');
            p = qq + 2;
            start = p;
            continue;
          }
          // The closing quote.
          const seg = qseg(start, qq);
          if (chunks === null) value = seg;
          else {
            chunks.push(seg);
            value = chunks.join('');
          }
          pos = qq + 1;
          closed = true;
          break;
        }
        if (!closed) {
          // The quote never closes: it is a literal character, and the text
          // after it is read again as an unquoted field.
          pos = open + 1;
          line = openLine;
          errors.push({ code: 'unterminated_quote', line: recLine, row: recRow });
          readUnquoted('"');
          value = uqValue;
          ended = uqEnded;
        } else if (pos >= len) {
          ended = 2;
        } else {
          const cc = text.charCodeAt(pos);
          if (cc === 44) {
            pos += 1;
            ended = 0;
          } else if (cc === 10) {
            pos += 1;
            line += 1;
            ended = 1;
          } else if (cc === 13 && text.charCodeAt(pos + 1) === 10) {
            pos += 2;
            line += 1;
            ended = 1;
          } else {
            // What follows the closing quote is appended as it stands, up
            // to the next comma or line break (quote_junk, when it ends).
            readUnquoted(value);
            if (uqAdded > 0) errors.push({ code: 'quote_junk', line: recLine, row: recRow });
            value = uqValue;
            ended = uqEnded;
          }
        }
      } else {
        // A quote inside an unquoted field is a literal character.
        readUnquoted('');
        value = uqValue;
        ended = uqEnded;
      }
      fields.push(value);
    } while (ended === 0);

    // A line that held only stray CRs is left with no characters: no record
    // (its stray_cr errors stay).
    if (fields.length === 1 && fields[0] === '' && !quoted) continue;

    finishRecord(fields);
  }
  return { columns: header ? (columns ?? []) : null, rows, errors };
}
