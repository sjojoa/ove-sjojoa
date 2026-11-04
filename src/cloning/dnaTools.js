// Core molecular-biology calculations for the Cloning menu: melting
// temperature, primer checks, primer design, mutagenesis, restriction cloning,
// Gibson/HiFi assembly and gel migration. No DOM code here, so it can be unit
// tested in Node (test/dnaTools.test.js).
//
// Sequence-with-annotations operations use @teselagen/sequence-utils (global
// `sequenceUtils` in the app, loaded from node_modules in tests).
(function (root) {
  const su =
    (typeof root !== "undefined" && root.sequenceUtils) ||
    (typeof require !== "undefined" && require("@teselagen/sequence-utils"));

  // ---------------------------------------------------------------- basics
  const COMP = { A: "T", T: "A", G: "C", C: "G", N: "N", R: "Y", Y: "R", K: "M", M: "K", S: "S", W: "W", B: "V", V: "B", D: "H", H: "D" };

  function clean(seq) {
    return String(seq || "").toUpperCase().replace(/[^ACGTNRYKMSWBVDH]/g, "");
  }
  function complement(seq) {
    let out = "";
    for (const ch of seq) {
      const up = ch.toUpperCase();
      const c = COMP[up] || "N";
      out += ch === up ? c : c.toLowerCase();
    }
    return out;
  }
  function revcomp(seq) {
    return complement(seq).split("").reverse().join("");
  }
  function gcPercent(seq) {
    const s = clean(seq);
    if (!s.length) return 0;
    return (100 * (s.match(/[GCS]/g) || []).length) / s.length;
  }
  // anhydrous ssDNA molecular weight (g/mol), 5'-OH
  function molecularWeight(seq) {
    const s = clean(seq);
    const w = { A: 313.21, T: 304.2, C: 289.18, G: 329.21 };
    let mw = -61.96;
    for (const ch of s) mw += w[ch] || 308.95;
    return Math.max(0, mw);
  }
  // circular-aware substring: [start, end) may run past the end
  function circSlice(seq, start, end, circular) {
    const n = seq.length;
    if (!circular) return seq.slice(Math.max(0, start), Math.min(n, end));
    let out = "";
    for (let i = start; i < end; i++) out += seq[((i % n) + n) % n];
    return out;
  }

  // ---------------------------------------------------- melting temperature
  // SantaLucia (1998) unified nearest-neighbour parameters (kcal/mol, cal/K/mol)
  const NN = {
    "AA/TT": [-7.9, -22.2], "AT/TA": [-7.2, -20.4], "TA/AT": [-7.2, -21.3],
    "CA/GT": [-8.5, -22.7], "GT/CA": [-8.4, -22.4], "CT/GA": [-7.8, -21.0],
    "GA/CT": [-8.2, -22.2], "CG/GC": [-10.6, -27.2], "GC/CG": [-9.8, -24.4],
    "GG/CC": [-8.0, -19.9],
  };
  const INIT_AT = [2.3, 4.1];
  const INIT_GC = [0.1, -2.8];
  const R = 1.987;

  const DEFAULT_CONDITIONS = { Na: 50, Mg: 1.5, dNTPs: 0.8, primerNM: 250 };

  function nnStack(pair) {
    // pair like "AG"; look up AG/TC or its reverse orientation
    const c = COMP[pair[0]] + COMP[pair[1]];
    return NN[`${pair}/${c}`] || NN[`${c.split("").reverse().join("")}/${pair.split("").reverse().join("")}`];
  }

  // Owczarzy et al. (2008) Mg2+/dNTP-aware salt correction (as Biopython saltcorr=7)
  function saltCorrection(seq, { Na, Mg, dNTPs }) {
    const a0 = 3.92, b = -0.911, c = 6.26, d0 = 1.42, e = -48.2, f = 52.5, g0 = 8.31;
    const mon = Na * 1e-3;
    let mg = Mg * 1e-3;
    const gc = gcPercent(seq) / 100;
    if (dNTPs > 0 && mg > 0) {
      const dntps = dNTPs * 1e-3;
      const ka = 3e4;
      mg = (-(ka * dntps - ka * mg + 1) + Math.sqrt((ka * dntps - ka * mg + 1) ** 2 + 4 * ka * mg)) / (2 * ka);
    }
    const monCorr = () => (4.29 * gc - 3.95) * 1e-5 * Math.log(mon) + 9.4e-6 * Math.log(mon) ** 2;
    let a = a0, d = d0, g = g0;
    if (mon > 0) {
      const ratio = Math.sqrt(mg) / mon;
      if (ratio < 0.22) return monCorr();
      if (ratio < 6) {
        a = 3.92 * (0.843 - 0.352 * Math.sqrt(mon) * Math.log(mon));
        d = 1.42 * (1.279 - 4.03e-3 * Math.log(mon) - 8.03e-3 * Math.log(mon) ** 2);
        g = 8.31 * (0.486 - 0.258 * Math.log(mon) + 5.25e-3 * Math.log(mon) ** 3);
      }
    }
    if (mg <= 0) return mon > 0 ? monCorr() : 0;
    const lmg = Math.log(mg);
    return (a + b * lmg + gc * (c + d * lmg) + (1 / (2 * (seq.length - 1))) * (e + f * lmg + g * lmg ** 2)) * 1e-5;
  }

  function thermo(seq) {
    let dH = 0, dS = 0;
    const ends = seq[0] + seq[seq.length - 1];
    for (const ch of ends) {
      const p = ch === "A" || ch === "T" ? INIT_AT : INIT_GC;
      dH += p[0];
      dS += p[1];
    }
    for (let i = 0; i < seq.length - 1; i++) {
      const p = nnStack(seq.substr(i, 2));
      if (!p) return null; // ambiguous base
      dH += p[0];
      dS += p[1];
    }
    return { dH, dS };
  }

  // Tm (°C) of a perfectly matched oligo annealed to its template
  function tm(seqIn, conditions = {}) {
    const cond = { ...DEFAULT_CONDITIONS, ...conditions };
    const seq = clean(seqIn);
    if (seq.length < 2) return NaN;
    const t = thermo(seq);
    if (!t) return NaN;
    let { dH, dS } = t;
    const selfComp = seq === revcomp(seq);
    if (selfComp) dS += -1.4;
    const k = (selfComp ? cond.primerNM : cond.primerNM) * 1e-9;
    let tmK = (1000 * dH) / (dS + R * Math.log(k));
    tmK = 1 / (1 / tmK + saltCorrection(seq, cond));
    return tmK - 273.15;
  }

  // ΔG37 (kcal/mol) of a perfectly paired duplex stretch, incl. initiation
  function duplexDG(stretch) {
    const t = thermo(stretch);
    if (!t) return 0;
    return t.dH - (310.15 * t.dS) / 1000;
  }

  // ------------------------------------------------ secondary structures
  // Best contiguous complementary stretch between a (5'->3') and b (5'->3')
  // at any offset. Returns { dG, length, involves3p (of a), text }.
  function bestDimer(aIn, bIn) {
    const a = clean(aIn);
    const b = clean(bIn);
    const bRev = b.split("").reverse().join(""); // b 3'->5'
    let best = { dG: 0, length: 0, involves3p: false };
    for (let shift = -(bRev.length - 1); shift < a.length; shift++) {
      let run = 0;
      for (let i = 0; i <= a.length; i++) {
        const j = i - shift;
        const pairs = i < a.length && j >= 0 && j < bRev.length && COMP[a[i]] === bRev[j];
        if (pairs) run++;
        if ((!pairs || i === a.length) && run >= 3) {
          const endA = i - 1;
          const stretch = a.slice(endA - run + 1, endA + 1);
          const dG = duplexDG(stretch);
          if (dG < best.dG) best = { dG, length: run, involves3p: endA >= a.length - 3, shift, startA: endA - run + 1 };
        }
        if (!pairs) run = 0;
      }
    }
    return best;
  }

  // stacking-only ΔG37 (no bimolecular initiation), for hairpin stems
  function stackDG(stretch) {
    let dG = 0;
    for (let i = 0; i < stretch.length - 1; i++) {
      const p = nnStack(stretch.substr(i, 2));
      if (p) dG += p[0] - (310.15 * p[1]) / 1000;
    }
    return dG;
  }
  // Turner hairpin loop initiation ΔG37 by loop size (kcal/mol)
  const HAIRPIN_LOOP = { 3: 5.4, 4: 5.6, 5: 5.7, 6: 5.4, 7: 6.0, 8: 6.1, 9: 6.2 };

  // Most stable simple hairpin (stem >= 3 bp, loop >= 3 nt)
  function bestHairpin(seqIn) {
    const s = clean(seqIn);
    let best = { dG: 0, stem: 0, loop: 0, involves3p: false };
    for (let i = 0; i < s.length; i++) {
      for (let j = s.length - 1; j > i + 3; j--) {
        let k = 0;
        while (i + k < j - k - 3 && COMP[s[i + k]] === s[j - k]) k++;
        if (k >= 3) {
          const loop = j - k - (i + k) + 1;
          const loopDG = HAIRPIN_LOOP[loop] || 6.2 + 1.75 * 0.616 * Math.log(loop / 9);
          const dG = stackDG(s.slice(i, i + k)) + loopDG;
          if (dG < best.dG) best = { dG, stem: k, loop, involves3p: j >= s.length - 2 };
        }
      }
    }
    return best;
  }

  function analyzeOligo(seqIn, conditions) {
    const seq = clean(seqIn);
    const warnings = [];
    const len = seq.length;
    const gc = gcPercent(seq);
    const t = tm(seq, conditions);
    const hairpin = bestHairpin(seq);
    const selfDimer = bestDimer(seq, seq);
    const last5 = seq.slice(-5);
    const gcEnd = (last5.match(/[GC]/g) || []).length;
    if (len && (gc < 40 || gc > 60)) warnings.push(`GC ${gc.toFixed(0)}% (ideal 40–60%)`);
    if (len && gcEnd === 0) warnings.push("no G/C in last 5 bases (weak 3′ end)");
    if (gcEnd > 3) warnings.push(`${gcEnd} G/C in last 5 bases (3′ end may misprime)`);
    if (/(A{5,}|C{5,}|G{5,}|T{5,})/.test(seq)) warnings.push("run of ≥5 identical bases");
    if (/([ACGT])(?!\1)([ACGT])(?:\1\2){3,}/.test(seq)) warnings.push("dinucleotide repeat (≥4×)");
    if (hairpin.dG < -3) warnings.push(`hairpin ΔG ${hairpin.dG.toFixed(1)} kcal/mol`);
    if (selfDimer.dG < -9 || (selfDimer.involves3p && selfDimer.dG < -5))
      warnings.push(`self-dimer ΔG ${selfDimer.dG.toFixed(1)} kcal/mol${selfDimer.involves3p ? " at 3′ end" : ""}`);
    return { seq, length: len, gc, tm: t, mw: molecularWeight(seq), hairpin, selfDimer, gcEnd, warnings };
  }

  // Suggested annealing temperatures for a primer pair
  function annealingTemps(tmF, tmR) {
    const low = Math.min(tmF, tmR);
    return {
      taq: Math.round((low - 5) * 10) / 10,
      // high-fidelity (Q5/Phusion) buffers anneal higher; ~Tm+3 capped at 72
      hifi: Math.round(Math.min(72, low + 3) * 10) / 10,
    };
  }

  // -------------------------------------------------------- primer design
  const PRIMER_DEFAULTS = {
    targetTm: 60, minTm: 55, maxTm: 65, minLen: 18, maxLen: 30,
    minGC: 35, maxGC: 65, maxTmDiff: 3, flank: 0, conditions: DEFAULT_CONDITIONS,
  };

  // binding site starting at `start` reading 5'->3' on the given strand
  function primerCandidates(template, circular, pos, strand, opts) {
    const out = [];
    for (let L = opts.minLen; L <= opts.maxLen; L++) {
      const seq =
        strand === 1
          ? circSlice(template, pos, pos + L, circular)
          : revcomp(circSlice(template, pos - L + 1, pos + 1, circular));
      if (seq.length < L) break;
      const t = tm(seq, opts.conditions);
      if (!isFinite(t)) continue;
      out.push({ seq, length: L, tm: t, pos, strand });
      if (t > opts.maxTm + 3) break;
    }
    return out;
  }

  function primerPenalty(p, opts) {
    const a = analyzeOligo(p.seq, opts.conditions);
    let pen = Math.abs(p.tm - opts.targetTm);
    if (a.gc < opts.minGC) pen += (opts.minGC - a.gc) / 2;
    if (a.gc > opts.maxGC) pen += (a.gc - opts.maxGC) / 2;
    if (a.gcEnd === 0) pen += 3;
    if (a.gcEnd > 3) pen += 2;
    if (a.hairpin.dG < -3) pen += -a.hairpin.dG - 3;
    if (a.selfDimer.dG < -6) pen += (-a.selfDimer.dG - 6) * (a.selfDimer.involves3p ? 2 : 1);
    if (p.tm < opts.minTm || p.tm > opts.maxTm) pen += 5;
    return { ...p, ...a, penalty: pen };
  }

  // Design primers amplifying [start, end] (0-based inclusive) of `template`.
  // opts.flank = how many bp outside the region primers may sit (0 = exact ends).
  // Returns ranked pairs.
  function designPrimers(templateIn, circular, region, userOpts = {}) {
    const opts = { ...PRIMER_DEFAULTS, ...userOpts, conditions: { ...DEFAULT_CONDITIONS, ...(userOpts.conditions || {}) } };
    const template = clean(templateIn);
    const n = template.length;
    const flank = Math.max(0, Math.floor(opts.flank || 0));
    const fwd = [];
    const rev = [];
    for (let d = 0; d <= flank; d++) {
      const fPos = region.start - d;
      const rPos = region.end + d;
      if (!circular && (fPos < 0 || rPos >= n)) continue;
      primerCandidates(template, circular, fPos, 1, opts).forEach((p) => fwd.push(primerPenalty({ ...p, offset: d }, opts)));
      primerCandidates(template, circular, rPos, -1, opts).forEach((p) => rev.push(primerPenalty({ ...p, offset: d }, opts)));
    }
    fwd.sort((x, y) => x.penalty - y.penalty);
    rev.sort((x, y) => x.penalty - y.penalty);
    const topF = fwd.slice(0, 25);
    const topR = rev.slice(0, 25);
    const pairs = [];
    const regionLen = region.end >= region.start ? region.end - region.start + 1 : n - region.start + region.end + 1;
    for (const f of topF) {
      for (const r of topR) {
        const dimer = bestDimer(f.seq, r.seq);
        let penalty = f.penalty + r.penalty + Math.max(0, Math.abs(f.tm - r.tm) - 1) * 1.5;
        if (Math.abs(f.tm - r.tm) > opts.maxTmDiff) penalty += 5;
        if (dimer.dG < -6) penalty += (-dimer.dG - 6) * (dimer.involves3p ? 2 : 1);
        penalty += (f.offset + r.offset) * 0.02; // prefer tighter products
        pairs.push({
          forward: f,
          reverse: r,
          productSize: regionLen + f.offset + r.offset,
          productStart: region.start - f.offset,
          productEnd: region.end + r.offset,
          heteroDimer: dimer,
          penalty,
          annealing: annealingTemps(f.tm, r.tm),
        });
      }
    }
    pairs.sort((x, y) => x.penalty - y.penalty);
    return pairs.slice(0, 10);
  }

  // ---------------------------------------------------- enzymes & digests
  const enzymesByName = (su && su.aliasedEnzymesByName) || {};
  // Commonly used cloning enzymes (shown first in pickers)
  const COMMON_ENZYMES = [
    "EcoRI", "BamHI", "HindIII", "XhoI", "NotI", "XbaI", "NheI", "KpnI", "SacI", "SalI",
    "PstI", "NcoI", "NdeI", "BglII", "EcoRV", "SmaI", "AgeI", "MluI", "SpeI", "ClaI",
    "ApaI", "AscI", "PacI", "SbfI", "AflII", "AvrII", "BsrGI", "MfeI", "NsiI", "SphI",
    "BsaI", "BsmBI", "BbsI", "SapI", "DpnI",
  ];
  // 5' extra bases added before a restriction site so the enzyme cuts efficiently
  const DEFAULT_LEADER = "GCGC";

  function getEnzyme(name) {
    const e = enzymesByName[String(name).toLowerCase()];
    if (!e) throw new Error(`Unknown enzyme: ${name}`);
    return e;
  }

  function cutPositions(seqData, enzymeNames) {
    const cuts = [];
    for (const name of enzymeNames) {
      const enz = getEnzyme(name);
      su.cutSequenceByRestrictionEnzyme(seqData.sequence, !!seqData.circular, enz).forEach((c) => {
        cuts.push({ enzyme: enz.name, top: c.topSnipPosition, bottom: c.bottomSnipPosition });
      });
    }
    const key = (c) => Math.min(c.top, c.bottom);
    cuts.sort((a, b) => key(a) - key(b));
    return cuts;
  }

  // Double-stranded fragments with their end structure. Coordinates are on
  // the original sequence (circular fragments may wrap). Each fragment:
  // { start, end (exclusive, may exceed length when wrapping), size,
  //   left: {type, seq, enzyme}, right: {type, seq, enzyme} }
  // Overhang seqs are written in top-strand sense; two ends ligate when types
  // and seqs match.
  function digest(seqData, enzymeNames) {
    const seq = seqData.sequence;
    const n = seq.length;
    const circular = !!seqData.circular;
    const cuts = cutPositions(seqData, enzymeNames);
    const end = (cut, side, offset = 0) => {
      const top = cut.top + offset;
      const bottom = cut.bottom + offset;
      const lo = Math.min(top, bottom);
      const hi = Math.max(top, bottom);
      let type = "blunt";
      if (top !== bottom) {
        if (side === "left") type = top < bottom ? "5'" : "3'";
        else type = top > bottom ? "3'" : "5'";
      }
      return { type, seq: circSlice(seq, lo, hi, circular).toUpperCase(), enzyme: cut.enzyme, lo, hi };
    };
    const frags = [];
    if (!cuts.length) {
      return [{ start: 0, end: n, size: n, circular, uncut: true, left: null, right: null }];
    }
    if (circular) {
      for (let i = 0; i < cuts.length; i++) {
        const a = cuts[i];
        const b = cuts[(i + 1) % cuts.length];
        const offset = i + 1 >= cuts.length ? n : 0;
        const L = end(a, "left");
        const Rt = end(b, "right", offset);
        frags.push({ start: L.lo, end: Rt.hi, size: Math.max(b.top + offset - a.top, 1), left: L, right: Rt });
      }
    } else {
      const ext = [{ top: 0, bottom: 0, enzyme: null, isEnd: true }, ...cuts, { top: n, bottom: n, enzyme: null, isEnd: true }];
      for (let i = 0; i < ext.length - 1; i++) {
        const a = ext[i];
        const b = ext[i + 1];
        const L = a.isEnd ? { type: "end", seq: "", lo: 0, hi: 0 } : end(a, "left");
        const Rt = b.isEnd ? { type: "end", seq: "", lo: n, hi: n } : end(b, "right");
        frags.push({ start: L.lo, end: Rt.hi, size: b.top - a.top, left: L, right: Rt });
      }
    }
    return frags.map((f, idx) => ({ ...f, index: idx }));
  }

  // Sub-sequence (with annotations) for [start, end) (end may exceed length)
  function sliceSeqData(seqData, start, end) {
    const n = seqData.sequence.length;
    if (end - start >= n && start === 0) return su.tidyUpSequenceData({ ...seqData, circular: false }, { annotationsAsObjects: false });
    const s = ((start % n) + n) % n;
    const e = (((end - 1) % n) + n) % n;
    const sub = su.getSequenceDataBetweenRange({ ...seqData }, { start: s, end: e });
    return su.tidyUpSequenceData({ ...sub, circular: false }, { annotationsAsObjects: false });
  }

  function reverseSeqData(seqData) {
    return su.tidyUpSequenceData(su.getReverseComplementSequenceAndAnnotations(seqData), { annotationsAsObjects: false });
  }

  const ANNOTATION_TYPES = ["features", "parts", "primers"];
  // Join sequence pieces, shifting annotations
  function concatSeqData(pieces, { name, circular }) {
    let sequence = "";
    const out = { features: [], parts: [], primers: [] };
    for (const piece of pieces) {
      const offset = sequence.length;
      const p = su.tidyUpSequenceData(piece, { annotationsAsObjects: false });
      ANNOTATION_TYPES.forEach((type) => {
        (p[type] || []).forEach((a) => {
          const copy = { ...a, start: a.start + offset, end: a.end + offset };
          delete copy.id;
          if (copy.locations) copy.locations = copy.locations.map((l) => ({ ...l, start: l.start + offset, end: l.end + offset }));
          out[type].push(copy);
        });
      });
      sequence += p.sequence;
    }
    return su.tidyUpSequenceData({ name, circular, sequence, ...out }, { annotationsAsObjects: false });
  }

  function addFeature(seqData, feature) {
    const d = su.tidyUpSequenceData(seqData, { annotationsAsObjects: false });
    d.features = [...(d.features || []), feature];
    return su.tidyUpSequenceData(d, { annotationsAsObjects: false });
  }

  // Fragment -> ligatable piece. `flip` reverse-complements it.
  function fragmentPiece(seqData, frag, flip) {
    let full = frag.uncut ? su.tidyUpSequenceData({ ...seqData, circular: false }, { annotationsAsObjects: false }) : sliceSeqData(seqData, frag.start, frag.end);
    let left = frag.left;
    let right = frag.right;
    if (flip) {
      full = reverseSeqData(full);
      const flipEnd = (e) => e && { ...e, seq: revcomp(e.seq) };
      [left, right] = [flipEnd(frag.right), flipEnd(frag.left)];
    }
    return { full, left, right };
  }

  function endsCompatible(rightEnd, leftEnd) {
    if (!rightEnd || !leftEnd) return false;
    if (rightEnd.type === "end" || leftEnd.type === "end") return false;
    return rightEnd.type === leftEnd.type && rightEnd.seq === leftEnd.seq;
  }

  // Ligate pieces (in order) into a circle. Returns null if ends don't match.
  function ligateCircular(pieces, name) {
    for (let i = 0; i < pieces.length; i++) {
      const next = pieces[(i + 1) % pieces.length];
      if (!endsCompatible(pieces[i].right, next.left)) return null;
    }
    const parts = pieces.map((p) => {
      const ov = p.right ? p.right.seq.length : 0;
      return ov ? sliceSeqData(p.full, 0, p.full.sequence.length - ov) : p.full;
    });
    return concatSeqData(parts, { name, circular: true });
  }

  // Restriction cloning: returns products for each insert orientation that ligates.
  function restrictionClone({ vector, vectorFragment, insert, insertFragment, name }) {
    const products = [];
    for (const flip of [false, true]) {
      const v = fragmentPiece(vector, vectorFragment, false);
      const ins = fragmentPiece(insert, insertFragment, flip);
      const product = ligateCircular([v, ins], name);
      if (product) {
        const insertLen = ins.full.sequence.length - (ins.right ? ins.right.seq.length : 0);
        const vLen = v.full.sequence.length - (v.right ? v.right.seq.length : 0);
        const withMarker = addFeature(product, {
          name: `${insert.name || "insert"}${flip ? " (reverse)" : ""}`,
          type: "misc_feature",
          start: vLen,
          end: vLen + insertLen - 1,
          forward: !flip,
          notes: { note: ["Inserted by restriction cloning"] },
        });
        products.push({ orientation: flip ? "reverse" : "forward", sequenceData: withMarker });
      }
    }
    const selfLigates = !!ligateCircular([fragmentPiece(vector, vectorFragment, false)], "self");
    return { products, vectorSelfLigates: selfLigates };
  }

  // --------------------------------------------------------- mutagenesis
  const CODON_TABLE = {
    TTT: "F", TTC: "F", TTA: "L", TTG: "L", CTT: "L", CTC: "L", CTA: "L", CTG: "L",
    ATT: "I", ATC: "I", ATA: "I", ATG: "M", GTT: "V", GTC: "V", GTA: "V", GTG: "V",
    TCT: "S", TCC: "S", TCA: "S", TCG: "S", CCT: "P", CCC: "P", CCA: "P", CCG: "P",
    ACT: "T", ACC: "T", ACA: "T", ACG: "T", GCT: "A", GCC: "A", GCA: "A", GCG: "A",
    TAT: "Y", TAC: "Y", TAA: "*", TAG: "*", CAT: "H", CAC: "H", CAA: "Q", CAG: "Q",
    AAT: "N", AAC: "N", AAA: "K", AAG: "K", GAT: "D", GAC: "D", GAA: "E", GAG: "E",
    TGT: "C", TGC: "C", TGA: "*", TGG: "W", CGT: "R", CGC: "R", CGA: "R", CGG: "R",
    AGT: "S", AGC: "S", AGA: "R", AGG: "R", GGT: "G", GGC: "G", GGA: "G", GGG: "G",
  };
  // Most frequent codon per amino acid (Kazusa codon usage tables)
  const PREFERRED_CODONS = {
    human: { A: "GCC", R: "CGG", N: "AAC", D: "GAC", C: "TGC", Q: "CAG", E: "GAG", G: "GGC", H: "CAC", I: "ATC", L: "CTG", K: "AAG", M: "ATG", F: "TTC", P: "CCC", S: "AGC", T: "ACC", W: "TGG", Y: "TAC", V: "GTG", "*": "TGA" },
    ecoli: { A: "GCG", R: "CGT", N: "AAC", D: "GAT", C: "TGC", Q: "CAG", E: "GAA", G: "GGC", H: "CAT", I: "ATT", L: "CTG", K: "AAA", M: "ATG", F: "TTT", P: "CCG", S: "AGC", T: "ACC", W: "TGG", Y: "TAT", V: "GTG", "*": "TAA" },
  };
  // Choose a codon for `aa` with the fewest changes from `oldCodon`,
  // tie-broken by host preference.
  function chooseCodon(oldCodon, aa, host = "human") {
    const target = aa.toUpperCase();
    const options = Object.keys(CODON_TABLE).filter((c) => CODON_TABLE[c] === target);
    if (!options.length) throw new Error(`Unknown amino acid: ${aa}`);
    const diff = (c) => [...c].filter((ch, i) => ch !== oldCodon.toUpperCase()[i]).length;
    const pref = PREFERRED_CODONS[host] || PREFERRED_CODONS.human;
    options.sort((x, y) => diff(x) - diff(y) || (y === pref[target]) - (x === pref[target]));
    return options[0];
  }

  // Pick the shortest length (>= minLen) reaching targetTm for an annealing
  // region starting at pos going 5'->3' on strand.
  function annealingRegion(template, circular, pos, strand, targetTm, conditions, minLen = 15, maxLen = 40) {
    let last = null;
    for (let L = minLen; L <= maxLen; L++) {
      const seq = strand === 1 ? circSlice(template, pos, pos + L, circular) : revcomp(circSlice(template, pos - L + 1, pos + 1, circular));
      if (seq.length < L) break;
      last = { seq, length: L, tm: tm(seq, conditions) };
      if (last.tm >= targetTm) break;
    }
    return last;
  }

  // Replace template[start..end] (0-based inclusive; end = start-1 for pure
  // insertion) with newBases. method: "q5" (non-overlapping, back-to-back,
  // NEB Q5 site-directed mutagenesis style) or "quikchange" (overlapping).
  function designMutagenesis(templateIn, circular, { start, end, newBases }, { method = "q5", targetTm = 60, conditions } = {}) {
    const template = clean(templateIn);
    const ins = clean(newBases);
    const delLen = end - start + 1;
    const mutated = template.slice(0, start) + ins + template.slice(end + 1);
    const cond = { ...DEFAULT_CONDITIONS, ...(conditions || {}) };
    if (method === "quikchange") {
      // mutation centred in a 25-45 nt primer, Tm >= 78 (Agilent formula)
      const qcTm = (seq, mismatches) => 81.5 + 0.41 * gcPercent(seq) - 675 / seq.length - (100 * mismatches) / seq.length;
      const mismatches = Math.max(ins.length, delLen);
      let flank = 10;
      let primer;
      let t;
      do {
        primer = circSlice(template, start - flank, start, circular) + ins + circSlice(template, end + 1, end + 1 + flank, circular);
        t = qcTm(primer, mismatches);
        flank++;
      } while ((t < 78 || primer.length < 25) && primer.length < 45);
      return {
        method,
        mutatedSequence: mutated,
        primers: [
          { name: "QC_F", seq: primer, tm: t, tmNote: "Agilent QuikChange formula" },
          { name: "QC_R", seq: revcomp(primer), tm: t, tmNote: "Agilent QuikChange formula" },
        ],
      };
    }
    // Q5-style: forward primer starts with the new bases (split long inserts),
    // reverse primer anneals immediately upstream, back-to-back.
    let fwdTail = ins;
    let revTail = "";
    if (ins.length > 12) {
      const half = Math.floor(ins.length / 2);
      revTail = ins.slice(0, half);
      fwdTail = ins.slice(half);
    }
    const fAnneal = annealingRegion(template, circular, end + 1, 1, targetTm, cond);
    const rAnneal = annealingRegion(template, circular, start - 1, -1, targetTm, cond);
    if (!fAnneal || !rAnneal) {
      throw new Error("Not enough template sequence next to the mutation to place primers (is the sequence linear and the mutation near an end?)");
    }
    // for substitutions put the change in the middle of the forward primer
    let fSeq = fwdTail + fAnneal.seq;
    let rSeq = revcomp(revTail) + rAnneal.seq;
    let rTm = rAnneal.tm;
    if (ins.length && delLen > 0 && ins.length <= 12) {
      // substitution: shift so mutation sits centrally with ~10 nt 5' clamp
      const clamp = circSlice(template, start - 10, start, circular);
      fSeq = clamp + ins + fAnneal.seq;
      const rA2 = annealingRegion(template, circular, start - 11, -1, targetTm, cond);
      if (!rA2) throw new Error("Not enough template sequence upstream of the mutation to place the reverse primer");
      rSeq = rA2.seq;
      rTm = rA2.tm;
    }
    return {
      method,
      mutatedSequence: mutated,
      primers: [
        { name: "SDM_F", seq: fSeq, tm: fAnneal.tm, tmNote: "Tm of the part annealing 3′ of the mutation" },
        { name: "SDM_R", seq: rSeq, tm: rTm, tmNote: "Tm of annealing part" },
      ],
    };
  }

  // Apply a mutation to annotated sequence data (keeps features)
  function mutateSeqData(seqData, { start, end, newBases }) {
    const replaced = su.insertSequenceDataAtPositionOrRange(
      { sequence: newBases },
      seqData,
      end >= start ? { start, end } : start
    );
    return su.tidyUpSequenceData(replaced, { annotationsAsObjects: false });
  }

  // ------------------------------------------------ Gibson / HiFi assembly
  // pieces: [{ seqData, reverse? }] in order; vector is pieces[0] when
  // circular. Overlaps are added to the insert primers. Returns primers per
  // piece + assembled construct.
  function designGibson(pieces, { overlap = 20, targetTm = 60, circular = true, conditions, vectorHasPrimers = false, name = "Assembly" } = {}) {
    const cond = { ...DEFAULT_CONDITIONS, ...(conditions || {}) };
    const seqs = pieces.map((p) => (p.reverse ? reverseSeqData(p.seqData) : su.tidyUpSequenceData(p.seqData, { annotationsAsObjects: false })));
    const count = seqs.length;
    const result = [];
    for (let i = 0; i < count; i++) {
      const s = clean(seqs[i].sequence);
      const isVector = i === 0 && circular;
      if (isVector && !vectorHasPrimers) {
        result.push({ name: seqs[i].name, isVector: true, primers: [] });
        continue;
      }
      const prev = i > 0 ? clean(seqs[i - 1].sequence) : circular ? clean(seqs[count - 1].sequence) : "";
      const next = i < count - 1 ? clean(seqs[i + 1].sequence) : circular ? clean(seqs[0].sequence) : "";
      const fAnn = annealingRegion(s, false, 0, 1, targetTm, cond, 18, 40);
      const rAnn = annealingRegion(s, false, s.length - 1, -1, targetTm, cond, 18, 40);
      // a PCR-linearised vector gets plain primers: the inserts carry the overlaps
      const fTail = isVector ? "" : prev.slice(-overlap);
      const rTail = isVector ? "" : revcomp(next.slice(0, overlap));
      result.push({
        name: seqs[i].name,
        isVector,
        primers: [
          { name: `${seqs[i].name}_GA_F`, seq: fTail.toLowerCase() + fAnn.seq, tm: fAnn.tm, overlapTm: fTail ? tm(fTail, cond) : null },
          { name: `${seqs[i].name}_GA_R`, seq: rTail.toLowerCase() + rAnn.seq, tm: rAnn.tm, overlapTm: rTail ? tm(next.slice(0, overlap), cond) : null },
        ],
      });
    }
    let construct = concatSeqData(seqs, { name, circular });
    // label each insert in the construct
    let offset = 0;
    seqs.forEach((sd, i) => {
      const len = sd.sequence.length;
      if (!(i === 0 && circular)) {
        construct = addFeature(construct, {
          name: sd.name || `insert ${i}`,
          type: "misc_feature",
          start: offset,
          end: offset + len - 1,
          forward: !pieces[i].reverse,
          notes: { note: ["Inserted by Gibson/HiFi assembly"] },
        });
      }
      offset += len;
    });
    return { pieces: result, construct };
  }

  // ------------------------------------------------------------- gels
  const LADDERS = {
    "GeneRuler 1 kb Plus": [20000, 10000, 7000, 5000, 4000, 3000, 2000, 1500, 1000, 700, 500, 400, 300, 200, 75],
    "GeneRuler 1 kb": [10000, 8000, 6000, 5000, 4000, 3500, 3000, 2500, 2000, 1500, 1000, 750, 500, 250],
    "NEB 1 kb": [10002, 8001, 6001, 5001, 4001, 3001, 2000, 1500, 1000, 517, 500],
    "NEB 1 kb Plus": [10002, 8001, 6001, 5001, 4001, 3001, 2000, 1500, 1200, 1000, 900, 800, 700, 600, 500, 400, 300, 200, 100],
    "NEB 100 bp": [1517, 1200, 1000, 900, 800, 700, 600, 517, 500, 400, 300, 200, 100],
    "GeneRuler 100 bp Plus": [3000, 2000, 1500, 1200, 1000, 900, 800, 700, 600, 500, 400, 300, 200, 100],
  };
  // Separation range (bp) per agarose %, used to scale migration
  const AGAROSE_RANGES = { 0.7: [800, 12000], 0.8: [700, 10000], 1: [500, 10000], 1.2: [400, 7000], 1.5: [200, 3000], 2: [100, 2000], 3: [50, 1000] };

  // Relative migration (0 = well, 1 = gel bottom) for a linear fragment
  function migration(bp, agarose = 1) {
    const [lo, hi] = AGAROSE_RANGES[agarose] || AGAROSE_RANGES[1];
    const x = (Math.log10(hi * 1.6) - Math.log10(Math.max(bp, 10))) / (Math.log10(hi * 1.6) - Math.log10(lo * 0.6));
    return Math.min(0.98, Math.max(0.03, 0.05 + 0.9 * x));
  }

  // Bands for a lane: digest seqData with enzymes (none => uncut)
  function laneBands(seqData, enzymeNames = []) {
    if (!enzymeNames.length) {
      if (seqData.circular) {
        const n = seqData.sequence.length;
        // uncut plasmid: supercoiled runs ~0.7x, nicked/open circular much slower
        return [
          { size: n, apparent: Math.round(n * 0.7), label: `${n} bp supercoiled`, intensity: 1 },
          { size: n, apparent: Math.round(n * 1.9), label: `${n} bp nicked/open circle`, intensity: 0.35 },
        ];
      }
      return [{ size: seqData.sequence.length, apparent: seqData.sequence.length, label: `${seqData.sequence.length} bp`, intensity: 1 }];
    }
    const frags = digest(seqData, enzymeNames);
    const total = seqData.sequence.length;
    return frags.map((f) => ({
      size: f.size,
      apparent: f.size,
      label: `${f.size} bp`,
      intensity: Math.min(1, 0.25 + (f.size / total) * 2),
    }));
  }

  const api = {
    clean, complement, revcomp, gcPercent, molecularWeight, circSlice,
    tm, duplexDG, bestDimer, bestHairpin, analyzeOligo, annealingTemps, DEFAULT_CONDITIONS,
    designPrimers, PRIMER_DEFAULTS, getEnzyme, COMMON_ENZYMES, DEFAULT_LEADER, enzymesByName,
    cutPositions, digest, sliceSeqData, reverseSeqData, concatSeqData, fragmentPiece, endsCompatible,
    ligateCircular, restrictionClone, CODON_TABLE, chooseCodon, designMutagenesis, mutateSeqData,
    annealingRegion, designGibson, LADDERS, AGAROSE_RANGES, migration, laneBands,
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (typeof root !== "undefined" && root.document) root.dnaTools = api;
})(typeof window !== "undefined" ? window : undefined);
