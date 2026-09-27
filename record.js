/* Release Record — rendering only.
 *
 * Every verdict and every figure on this page was computed by the Release
 * Record engine at build time and arrives in window.RELEASE_RECORD. This file
 * does no arithmetic, holds no threshold, and contains no copy of the verdict
 * logic. It selects a record and prints it.
 *
 * That is not fussiness. Two implementations of a decision rule drift, and the
 * one people read is the one that is wrong. If a number here needs to change,
 * it changes in build/release_record_export.py, which refuses to write at all
 * unless every record still matches the engine's own golden output.
 */
(function () {
  'use strict';

  var D = window.RELEASE_RECORD;
  var root = document.querySelector('[data-record]');
  if (!D || !root) return;

  var state = { src: 'nhtsa', claim: 0 };

  function esc(s) {
    return String(s === null || s === undefined ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  /* Presentation only: which of the site's three reserved status hues a
   * verdict is drawn in. The verdict STRING is the engine's and is printed
   * verbatim; this only chooses a colour for it. Anything unrecognised falls
   * through to neutral grey rather than being guessed at. */
  var HUE = {
    verified: '', reconstructed: 'tag--wait', unknown: 'tag--no',
    present: '', missing: 'tag--wait',
    supported: '', 'not supported': 'tag--no',
    'insufficient evidence': 'tag--wait', 'no claim on file': 'tag--grey',
    capable: '', incapable: 'tag--no', indeterminate: 'tag--wait'
  };
  function hue(v) {
    return HUE[v] === undefined ? 'tag--grey' : HUE[v];
  }

  // ------------------------------------------------------------- the record

  function verdictTile(label, value, note) {
    return '<div class="rr-v">' +
      '<p class="lbl">' + esc(label) + '</p>' +
      '<p class="rr-v__val"><span class="tag ' + hue(value) + '">' +
        esc(value) + '</span></p>' +
      (note ? '<p class="rr-v__note">' + esc(note) + '</p>' : '') +
      '</div>';
  }

  function row(k, v, mono) {
    return '<div class="rr-row"><span>' + esc(k) + '</span>' +
      '<span' + (mono ? ' class="mono"' : '') + '>' + esc(v) + '</span></div>';
  }

  function render(rec, src) {
    var d = rec.display || {};
    var h = [];

    h.push('<div class="rr-rec">');

    // Header: one release pair, one claim.
    h.push('<div class="rr-rec__head">');
    h.push('<p class="lbl">Release Record · ' + esc(D.engine) + '</p>');
    h.push('<h2>' + esc(rec.baseline_label) + ' <span class="rr-arrow">&rarr;</span> ' +
           esc(rec.candidate_label) + '</h2>');
    h.push('<div class="rr-rec__meta">');
    h.push(row('Measure', rec.measure));
    h.push(row('Claim on file', rec.claim_text || 'none'));
    if (rec.effect_pp !== null && rec.effect_pp !== undefined) {
      h.push(row('Claim form',
        rec.claim_form === 'at_least'
          ? 'at least ' + d.claimed + ' — the whole interval must clear it'
          : 'exactly ' + d.claimed + ' — the interval must cover it'));
    }
    h.push(row('Evidence class', src.evidence_class));
    h.push('</div></div>');

    // The four verdicts.
    h.push('<div class="rr-vs">');
    h.push(verdictTile('Release identity', rec.identity,
      rec.identity_declared ? 'Not checkable: the source has no per-event file' : null));
    h.push(verdictTile('Exposure', rec.exposure,
      rec.exposure_declared ? 'Not checkable: the source has no per-event file' : null));
    h.push(verdictTile('Claim', rec.claim, null));
    h.push(verdictTile('Sufficiency', rec.sufficiency,
      'Detection limit ' + rec.mde_basis));
    h.push('</div>');

    // The figures, exactly as the engine printed them.
    if (d.difference) {
      h.push('<div class="rr-block"><p class="lbl">What the evidence shows</p>');
      h.push(row('Baseline', d.baseline, true));
      h.push(row('Candidate', d.candidate, true));
      h.push(row('Difference', d.difference + '  ' + d.interval, true));
      h.push(row('Detection limit', d.detection_limit_full, true));
      // The exporter's plain reading of these figures, printed as written.
      if (src.reading) {
        h.push('<p class="verdict verdict--wait">' + esc(src.reading) + '</p>');
      }
      h.push('</div>');
    } else {
      h.push('<div class="rr-block"><p class="lbl">What the evidence shows</p>' +
        '<p class="rr-none">No comparison was possible from this evidence.</p></div>');
    }

    // Provenance: what was read, and what it hashes to.
    h.push('<div class="rr-block"><p class="lbl">Source</p>');
    h.push(row('Name', src.name));
    if (src.file) h.push(row('File', src.file, true));
    if (src.pulled) h.push(row('Pulled', src.pulled, true));
    if (src.sha256) h.push(row('Snapshot sha256', src.sha256, true));
    if (rec.provenance) h.push(row('Provenance', rec.provenance));
    if (rec.n_status && rec.n_status !== 'stated') {
      h.push(row('Episodes', 'not stated by the paper', true));
    } else {
      h.push(row('Events in', rec.events_in, true));
      h.push(row('Events used', d.events_used, true));
    }
    if (rec.unlabelled) h.push(row('Unlabelled events', rec.unlabelled, true));
    h.push('<p class="rr-checked">' + esc(src.checked) + '</p>');
    h.push('</div>');

    // Adjudication: raw strings preserved, never quietly merged.
    if (rec.merged_variants.length || rec.flagged_for_adjudication.length) {
      h.push('<div class="rr-block"><p class="lbl">Release labels</p>');
      rec.merged_variants.forEach(function (m) {
        h.push('<p class="rr-flag rr-flag--merge"><span class="tag tag--grey">Merged</span> ' +
          '<span class="mono">' + esc(m) + '</span></p>');
      });
      rec.flagged_for_adjudication.forEach(function (f) {
        h.push('<p class="rr-flag"><span class="tag tag--wait">Flagged</span> ' +
          '<span class="mono">' + esc(f) + '</span></p>');
      });
      h.push('</div>');
    }

    // The engine's own caveats, verbatim.
    if (rec.notes.length) {
      h.push('<div class="rr-block"><p class="lbl">Notes</p>');
      rec.notes.forEach(function (n) {
        h.push('<p class="verdict verdict--wait">' + esc(n) + '</p>');
      });
      h.push('</div>');
    }

    // The tool's plain-text output, so the page can be checked against it.
    h.push('<details class="rr-raw"><summary>Engine output, verbatim</summary>' +
      '<pre class="mono">' + esc(rec.rendered) + '</pre></details>');

    h.push('</div>');
    return h.join('');
  }

  // ------------------------------------------------------------- the picker

  function current() {
    return state.src === 'nhtsa' ? D.nhtsa : D.corpus2[state.claim];
  }

  function paint() {
    var pick = document.querySelector('[data-claim-pick]');
    var note = document.querySelector('[data-go-note]');
    var go = document.querySelector('[data-generate]');
    var upload = state.src === 'upload';

    document.querySelectorAll('.rr-src').forEach(function (b) {
      b.setAttribute('aria-checked', String(b.dataset.src === state.src));
    });
    pick.hidden = state.src !== 'corpus2';
    go.disabled = upload;
    note.textContent = upload
      ? 'This page is a static site with no runtime, so it cannot execute your file here.'
      : '';

    if (upload) {
      root.hidden = false;
      root.innerHTML =
        '<div class="rr-rec rr-rec--off"><div class="rr-rec__head">' +
        '<p class="lbl">Upload · unavailable</p>' +
        '<h2>Execution unavailable on this static site</h2>' +
        '<p class="rr-none">This page has no runtime, so nothing here can read your file, ' +
        'and a result invented in the browser would be exactly the fabrication this tool ' +
        'exists to catch. The engine that produced the records above is not yet ' +
        'published.</p>' +
        '<p class="rr-none">It reads one row per event, with these columns: ' +
        'event id, event time, release label, outcome (1 or 0), revision, and exposure ' +
        'where it was recorded. Rows with no release label and no denominator are still ' +
        'accepted — they return <strong>unknown</strong> and <strong>missing</strong> ' +
        'rather than being refused.</p>' +
        '</div></div>';
      root.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }

  function generate(quiet) {
    if (state.src === 'upload') return;
    var src = D.sources[state.src === 'nhtsa' ? 'nhtsa' : 'corpus2'];
    root.hidden = false;
    root.innerHTML = render(current(), src);
    if (quiet !== true) root.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function init() {
    document.querySelector('[data-src-meta="nhtsa"]').textContent =
      D.sources.nhtsa.pulled + ' · sha256 ' + D.sources.nhtsa.sha256.slice(0, 12) + '…';
    document.querySelector('[data-src-meta="corpus2"]').textContent =
      D.counts.corpus2_records + ' cited claims · sha256 ' +
      D.sources.corpus2.sha256.slice(0, 12) + '…';

    var sel = document.getElementById('rr-claim-select');
    D.corpus2.forEach(function (c, i) {
      var o = document.createElement('option');
      o.value = String(i);
      o.textContent = c.paper + ' — ' + c.claim_text + ' (' + c.display.claimed + ')';
      sel.appendChild(o);
    });
    sel.addEventListener('change', function () {
      state.claim = Number(sel.value);
      if (!root.hidden) generate();
    });

    /* A link can open one record: #nhtsa, or #claim-N counting from 0. With
     * ?embed=1 the page shows that record alone, which is how the home page
     * frames it. Nothing is chosen here that a visitor could not choose. */
    var embed = /[?&]embed=1(&|$)/.test(location.search);
    if (embed) document.documentElement.classList.add('rr-embed');
    var m = /^#(?:(nhtsa)|claim-(\d+))$/.exec(location.hash);
    var linked = !!m && (!!m[1] || !!D.corpus2[Number(m[2])]);
    if (linked && m[2] !== undefined) {
      state.src = 'corpus2';
      state.claim = Number(m[2]);
      sel.value = String(state.claim);
    }

    /* A radiogroup promises arrow-key navigation, so it has to work. Tab
     * reaches the group, arrows move within it, and the moved-to option is
     * selected and focused the way a native radio behaves. */
    var srcs = Array.prototype.slice.call(document.querySelectorAll('.rr-src'));
    function choose(b) {
      state.src = b.dataset.src;
      root.hidden = true;
      paint();
      srcs.forEach(function (x) { x.tabIndex = x === b ? 0 : -1; });
    }
    srcs.forEach(function (b, i) {
      b.tabIndex = b.dataset.src === state.src ? 0 : -1;
      b.addEventListener('click', function () { choose(b); });
      b.addEventListener('keydown', function (e) {
        var step = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1
                 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
        if (!step) return;
        e.preventDefault();
        var next = srcs[(i + step + srcs.length) % srcs.length];
        choose(next);
        next.focus();
      });
    });

    document.querySelector('[data-generate]').addEventListener('click', generate);
    paint();
    if (linked) generate(embed);
  }

  init();
})();
