# csv-reader-speed — a faster drop-in for csv-reader 1.0.0

[![make.fun](https://make.fun/badge/csv-reader-speed-01-run-20261121.svg)](https://make.fun/c/csv-reader-speed-01-run-20261121)
[![rank](https://make.fun/badge/csv-reader-speed-01-run-20261121/indraHA01/makefun-csv-reader-speed-01-run-20261121/rank.svg)](https://make.fun/c/csv-reader-speed-01-run-20261121)
[![reward](https://make.fun/badge/csv-reader-speed-01-run-20261121/indraHA01/makefun-csv-reader-speed-01-run-20261121/reward.svg)](https://make.fun/c/csv-reader-speed-01-run-20261121)

A [make.fun](https://make.fun) entry for **Read broken CSV files faster, 21 November 2026** — `solve.js` answers exactly as csv-reader 1.0.0 does on every case (`{columns, rows, errors}` with all its broken-CSV quirks), but reads the text without ever walking it one character at a time.

## The angle: split the clean, scan the broken

csv-reader 1.0.0 is written to be plain and easy to check: one character at a time, each field built up a character at a time. This entry keeps its reading exactly and changes only how the text is traversed:

- **Clean records are split whole.** A record whose line holds no quote and no stray CR is one `slice` plus one native `String.split(',')` — no per-field scan at all. Most records of a drawn set are clean.
- **Broken fields are located, not walked.** An unquoted field ends at the next comma, LF or CR, found by a single native regex scan (`/[,\n\r]/g`) instead of three `indexOf` calls; a quoted field ends at the next quote, found with `indexOf`, doubled quotes folded in as segments are sliced.
- **Quoted segments are slices.** A quoted segment with no line break inside is a plain slice; only a segment holding a CR or LF takes the slow road that turns CRLF and lone CR into LF and counts the lines.
- **No allocation per field.** The unquoted reader writes into shared out-variables instead of returning a fresh object per field.

Everything else mirrors csv-reader 1.0.0: the BOM drop, empty lines as no record, stray CRs dropped with `stray_cr`, unterminated quotes re-read as unquoted with `unterminated_quote`, junk after a closing quote appended with `quote_junk`, `short_row` padding and `long_row` cutting to the first record's width, and every error's line and row in the order met.

## Files

- `solve.js` — dependency-free ES module; `run(input)` returns csv-reader 1.0.0's answer for `{text, header}`.
- `main.ts` — the program the harness runs: reads every case from `/input/cases.json`, answers each with `run`, writes `/output/answers.json`. Turns V8's incremental marking off before importing `solve.js`, the way the house driver does.

## Verified

- All 6 practice cases byte-identical to the kit's reference answers.
- 72 freshly drawn cases from the kit's own generator (12 new seeds) — every answer identical to csv-reader 1.0.0.
- 5,956 fuzz checks (random quote/CR/CRLF soup, structured broken records, unterminated-quote tails, hand-picked edges) — 0 mismatches against csv-reader 1.0.0. The fuzzer caught one real bug (a lone trailing CR at end of text) and it is fixed.

## Speed (practice set, this machine, fresh process per run)

| entry | median wall |
| --- | --- |
| csv-reader 1.0.0 (house baseline) | ~1,570 ms |
| this entry | ~682 ms |

Pure `run()` time, in process: ~147 ms vs ~499 ms for the reference reader — about **3.4×** on the parse itself.

## Run

```sh
node main.ts
```

Reads `/input/cases.json` (or `$MAKEFUN_INPUT_DIR/cases.json`) and writes `/output/answers.json` (or `$MAKEFUN_OUTPUT_DIR/answers.json`). Node 22.

## License

MIT — see [LICENSE](LICENSE).
