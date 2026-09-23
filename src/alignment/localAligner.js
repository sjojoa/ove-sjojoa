// Local (offline) replacement for the defunct TeselaGen alignment server
// (j5server.teselagen.com/alignment/run). It is passed to OVE as the
// `handleAlignment` option and returns data in the same shape the server did:
//   { alignedSequences } | { alignmentsToRefSeq } | { pairwiseAlignments }
//
// Every non-template sequence is aligned to the template (sequence #0) with an
// affine-gap "overlap" alignment (end gaps are free, so short sequencing reads
// can land anywhere on a long reference). Both strands are tried; reads that
// match the reverse strand are reverse-complemented in place, along with their
// chromatogram, so traces display correctly. For multiple-sequence mode the
// pairwise results are merged into one reference-anchored alignment.
(function () {
  const SCORING = {
    match: 2,
    mismatch: -3,
    ambiguous: 0, // N or any IUPAC ambiguity code
    gapOpen: 5,
    gapExtend: 2,
  };
  // above this many DP cells we first narrow the reference down using k-mer seeds
  const MAX_FULL_DP_CELLS = 3e7;
  const SEED_K = 12;

  const COMPLEMENT = {
    a: "t", t: "a", g: "c", c: "g", u: "a", r: "y", y: "r", k: "m", m: "k",
    s: "s", w: "w", b: "v", v: "b", d: "h", h: "d", n: "n", "-": "-", ".": ".",
  };

  function complementChar(ch) {
    const lower = ch.toLowerCase();
    const comp = COMPLEMENT[lower] || "n";
    return ch === lower ? comp : comp.toUpperCase();
  }

  function reverseComplement(seq) {
    let out = "";
    for (let i = seq.length - 1; i >= 0; i--) out += complementChar(seq[i]);
    return out;
  }

  function encode(seq) {
    // A=0 C=1 G=2 T=3, anything else=4
    const codes = new Uint8Array(seq.length);
    for (let i = 0; i < seq.length; i++) {
      switch (seq.charCodeAt(i) | 32) {
        case 97: codes[i] = 0; break;
        case 99: codes[i] = 1; break;
        case 103: codes[i] = 2; break;
        case 116:
        case 117: codes[i] = 3; break;
        default: codes[i] = 4;
      }
    }
    return codes;
  }

  // Overlap alignment of `read` against `ref` (both strings).
  // Returns { score, refAligned, readAligned } with "-" for gaps.
  function overlapAlign(ref, read) {
    const n = ref.length;
    const m = read.length;
    const r = encode(ref);
    const q = encode(read);
    const { match, mismatch, ambiguous, gapOpen, gapExtend } = SCORING;
    const openCost = gapOpen + gapExtend;
    const NEG = -1e9;
    const width = n + 1;

    // trace bits: 0-1 = source of H (0 diag, 1 E/horizontal, 2 F/vertical)
    //             bit 2 = E extended, bit 3 = F extended
    const trace = new Uint8Array((m + 1) * width);
    let Hprev = new Int32Array(width); // row 0: free leading ref gap
    let Hcur = new Int32Array(width);
    const F = new Int32Array(width).fill(NEG);

    let best = 0;
    let bestI = 0;
    let bestJ = 0;

    for (let i = 1; i <= m; i++) {
      const qi = q[i - 1];
      Hcur[0] = 0; // free leading read overhang
      let E = NEG;
      const rowOffset = i * width;
      for (let j = 1; j <= n; j++) {
        let bits = 0;
        const eOpen = Hcur[j - 1] - openCost;
        const eExt = E - gapExtend;
        if (eExt > eOpen) { E = eExt; bits |= 4; } else E = eOpen;

        const fOpen = Hprev[j] - openCost;
        const fExt = F[j] - gapExtend;
        let f;
        if (fExt > fOpen) { f = fExt; bits |= 8; } else f = fOpen;
        F[j] = f;

        const rj = r[j - 1];
        const s = qi === 4 || rj === 4 ? ambiguous : qi === rj ? match : mismatch;
        let h = Hprev[j - 1] + s;
        if (E > h) { h = E; bits |= 1; }
        if (f > h) { h = f; bits = (bits & ~3) | 2; }
        Hcur[j] = h;
        trace[rowOffset + j] = bits;
      }
      // read fully consumed on the last row, or ref fully consumed in the last column
      if (i === m) {
        for (let j = 0; j <= n; j++) {
          if (Hcur[j] > best) { best = Hcur[j]; bestI = i; bestJ = j; }
        }
      } else if (Hcur[n] > best) {
        best = Hcur[n]; bestI = i; bestJ = n;
      }
      const tmp = Hprev; Hprev = Hcur; Hcur = tmp;
    }
    if (m === 0) { bestI = 0; bestJ = n; }

    // traceback (built in reverse)
    const refOut = [];
    const readOut = [];
    // trailing overhangs (free end gaps)
    for (let j = n; j > bestJ; j--) { refOut.push(ref[j - 1]); readOut.push("-"); }
    for (let i = m; i > bestI; i--) { refOut.push("-"); readOut.push(read[i - 1]); }

    let i = bestI;
    let j = bestJ;
    let state = 0; // 0 = H, 1 = E, 2 = F
    while (i > 0 && j > 0) {
      const bits = trace[i * width + j];
      if (state === 0) state = bits & 3;
      if (state === 0) {
        refOut.push(ref[j - 1]); readOut.push(read[i - 1]);
        i--; j--;
      } else if (state === 1) {
        refOut.push(ref[j - 1]); readOut.push("-");
        state = bits & 4 ? 1 : 0;
        j--;
      } else {
        refOut.push("-"); readOut.push(read[i - 1]);
        state = bits & 8 ? 2 : 0;
        i--;
      }
    }
    // leading overhangs (free end gaps)
    for (; j > 0; j--) { refOut.push(ref[j - 1]); readOut.push("-"); }
    for (; i > 0; i--) { refOut.push("-"); readOut.push(read[i - 1]); }

    return {
      score: best,
      refAligned: refOut.reverse().join(""),
      readAligned: readOut.reverse().join(""),
    };
  }

  // For very long references, find the region the read most likely maps to
  // (by counting shared k-mers per diagonal) so the DP stays small.
  function seedWindow(ref, read) {
    const k = SEED_K;
    if (read.length < k || ref.length < k) return null;
    const refUpper = ref.toUpperCase();
    const readUpper = read.toUpperCase();
    const kmers = new Map();
    for (let i = 0; i + k <= readUpper.length; i++) {
      const kmer = readUpper.substr(i, k);
      if (kmer.indexOf("N") !== -1) continue;
      if (!kmers.has(kmer)) kmers.set(kmer, []);
      kmers.get(kmer).push(i);
    }
    const binSize = 64;
    const diagonalVotes = new Map();
    let bestBin = null;
    let bestVotes = 0;
    for (let j = 0; j + k <= refUpper.length; j++) {
      const hits = kmers.get(refUpper.substr(j, k));
      if (!hits) continue;
      for (const i of hits) {
        const bin = Math.floor((j - i) / binSize);
        const votes = (diagonalVotes.get(bin) || 0) + 1;
        diagonalVotes.set(bin, votes);
        if (votes > bestVotes) { bestVotes = votes; bestBin = bin; }
      }
    }
    if (bestBin === null) return { votes: 0 };
    const pad = Math.max(200, Math.round(read.length * 0.3));
    const start = Math.max(0, bestBin * binSize - pad);
    const end = Math.min(ref.length, (bestBin + 1) * binSize + read.length + pad);
    return { votes: bestVotes, start, end };
  }

  function alignWithOptionalWindow(ref, read) {
    if (ref.length * read.length <= MAX_FULL_DP_CELLS) {
      return overlapAlign(ref, read);
    }
    const win = seedWindow(ref, read);
    if (!win || !win.votes) {
      // no hit: show the read as an unaligned overhang after the reference
      return {
        score: -Infinity,
        refAligned: ref + "-".repeat(read.length),
        readAligned: "-".repeat(ref.length) + read,
        noSeed: true,
      };
    }
    const res = overlapAlign(ref.slice(win.start, win.end), read);
    // pad back out to the full reference
    res.refAligned = ref.slice(0, win.start) + res.refAligned + ref.slice(win.end);
    res.readAligned =
      "-".repeat(win.start) + res.readAligned + "-".repeat(ref.length - win.end);
    return res;
  }

  // Choose the better strand for `read` against `ref`.
  function alignBestStrand(ref, read) {
    const fwd = alignWithOptionalWindow(ref, read);
    const rc = reverseComplement(read);
    const rev = alignWithOptionalWindow(ref, rc);
    if (rev.score > fwd.score) return { ...rev, reversed: true, alignedInput: rc };
    return { ...fwd, reversed: false, alignedInput: read };
  }

  // Per-base trace windows for OVE's chromatogram renderer, built from the raw
  // traces + peak positions. Always rebuilt so that trimmed or reversed reads
  // stay consistent (OVE's auto-trim does not trim baseTraces).
  function buildBaseTraces(chrom) {
    const { basePos, aTrace } = chrom;
    const traceLength = aTrace.length;
    const baseTraces = [];
    for (let i = 0; i < basePos.length; i++) {
      const prev = i > 0 ? basePos[i - 1] : null;
      const next = i < basePos.length - 1 ? basePos[i + 1] : null;
      const halfLeft = prev !== null ? (basePos[i] - prev) / 2 : next !== null ? (next - basePos[i]) / 2 : 5;
      const halfRight = next !== null ? (next - basePos[i]) / 2 : halfLeft;
      const start = Math.max(0, Math.round(basePos[i] - halfLeft));
      const end = Math.min(traceLength, Math.max(start + 1, Math.round(basePos[i] + halfRight)));
      const entry = {};
      ["aTrace", "cTrace", "gTrace", "tTrace"].forEach((type) => {
        entry[type] = Array.prototype.slice.call(chrom[type], start, end);
      });
      baseTraces.push(entry);
    }
    return baseTraces;
  }

  function reverseComplementChromatogram(chrom) {
    const traceLength = chrom.aTrace.length;
    const rev = (arr) => Array.prototype.slice.call(arr).reverse();
    const out = {
      ...chrom,
      aTrace: rev(chrom.tTrace),
      tTrace: rev(chrom.aTrace),
      cTrace: rev(chrom.gTrace),
      gTrace: rev(chrom.cTrace),
      basePos: rev(chrom.basePos).map((p) => traceLength - 1 - p),
      baseCalls: rev(chrom.baseCalls).map(complementChar),
    };
    if (chrom.qualNums) out.qualNums = rev(chrom.qualNums);
    return out;
  }

  function hasRawTraces(chrom) {
    return (
      chrom && chrom.aTrace && chrom.cTrace && chrom.gTrace && chrom.tTrace && chrom.basePos
    );
  }

  // Mutates a sequence object from the alignment dialog so that its sequence
  // (and chromatogram) match what was aligned.
  function prepareSequenceForDisplay(seqObj, reversed) {
    let chrom = seqObj.chromatogramData;
    if (reversed) {
      seqObj.sequence = reverseComplement(seqObj.sequence);
      seqObj.name = `${seqObj.name || "Untitled"} (rev-comp)`;
      // annotations no longer map after reverse-complementing a read
      seqObj.features = [];
      seqObj.parts = [];
      seqObj.primers = [];
      if (hasRawTraces(chrom)) chrom = reverseComplementChromatogram(chrom);
      else if (chrom) chrom = undefined;
    }
    if (hasRawTraces(chrom)) {
      chrom = { ...chrom, baseTraces: buildBaseTraces(chrom) };
      if (!chrom.baseCalls || chrom.baseCalls.length !== seqObj.sequence.length) {
        chrom = undefined; // can't display a chromatogram that doesn't match
      }
    }
    seqObj.chromatogramData = chrom;
  }

  // Merge per-read alignments against the same reference into one MSA.
  function mergeToReference(ref, pairs) {
    const n = ref.length;
    const maxIns = new Array(n + 1).fill(0);
    const parsed = pairs.map(({ refAligned, readAligned }) => {
      const ins = Array.from({ length: n + 1 }, () => "");
      const cols = new Array(n);
      let k = 0;
      for (let c = 0; c < refAligned.length; c++) {
        if (refAligned[c] === "-") ins[k] += readAligned[c];
        else cols[k++] = readAligned[c];
      }
      ins.forEach((s, idx) => { if (s.length > maxIns[idx]) maxIns[idx] = s.length; });
      return { ins, cols };
    });
    const build = (getIns, getCol) => {
      const parts = [];
      for (let k = 0; k <= n; k++) {
        const s = getIns(k);
        parts.push(s + "-".repeat(maxIns[k] - s.length));
        if (k < n) parts.push(getCol(k));
      }
      return parts.join("");
    };
    const refRow = build(() => "", (k) => ref[k]);
    const readRows = parsed.map(({ ins, cols }) => build((k) => ins[k], (k) => cols[k]));
    return { refRow, readRows };
  }

  // Must be synchronous: OVE uses the return value of handleAlignment directly
  // (it does not await it).
  function handleAlignment({ sequencesToAlign, isPairwiseAlignment, isAlignToRefSeq }) {
    try {
      if (!sequencesToAlign || sequencesToAlign.length < 2) {
        window.toastr && window.toastr.warning("Add at least one sequence to align to the template.");
        return {};
      }
      const [template, ...others] = sequencesToAlign;
      const ref = template.sequence;
      const results = [];
      for (const seqObj of others) {
        const res = alignBestStrand(ref, seqObj.sequence);
        if (res.noSeed) {
          window.toastr &&
            window.toastr.warning(`${seqObj.name}: no match found on the reference`);
        }
        prepareSequenceForDisplay(seqObj, res.reversed);
        results.push(res);
      }

      if (isPairwiseAlignment) {
        return {
          pairwiseAlignments: results.map((res, idx) => [
            { name: `0_${template.name}`, sequence: res.refAligned },
            { name: `${idx + 1}_${others[idx].name}`, sequence: res.readAligned },
          ]),
        };
      }

      const { refRow, readRows } = mergeToReference(ref, results);
      const alignedSequences = [
        { name: `0_${template.name}`, sequence: refRow },
        ...readRows.map((row, idx) => ({ name: `${idx + 1}_${others[idx].name}`, sequence: row })),
      ];
      return isAlignToRefSeq ? { alignmentsToRefSeq: alignedSequences } : { alignedSequences };
    } catch (error) {
      console.error("Local alignment failed:", error);
      window.toastr && window.toastr.error(`Alignment failed: ${error.message}`);
      return {};
    }
  }

  const api = {
    handleAlignment,
    overlapAlign,
    alignBestStrand,
    mergeToReference,
    reverseComplement,
    reverseComplementChromatogram,
    buildBaseTraces,
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (typeof window !== "undefined") window.oveLocalAligner = api;
})();
