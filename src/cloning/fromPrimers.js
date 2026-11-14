// Cloning the other way round: start from the primers, work out the construct.
//
// The Cloning tools design primers and hand you a map. This does the reverse,
// for the common case where the design was done somewhere else -- NEBuilder, a
// collaborator's email, an order placed six months ago -- and what you have is
// a pair of oligos and the templates they run on (#20).
//
// Nothing here guesses. A primer pair plus its template determines the
// product: the 3' annealing region says where each primer sits, the bases of
// the primer (not the template under it) go into the product, so mismatches
// are the edit, and the 5' tails say what the product is meant to join to.
//
// The verdict matters as much as the map. An externally designed set is
// exactly the one that has never been checked against the real plasmid, so
// every entry point returns `problems` alongside whatever it could build, and
// builds nothing it is not sure of.
(function (root, factory) {
  const req = typeof require === "function" && typeof module !== "undefined";
  const api = factory(req ? require("../features/primerHybridization") : root.ovePrimerHybridization);
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (typeof root !== "undefined" && root.document) root.oveFromPrimers = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (H) {
  const clean = (s) => String(s || "").replace(/[^A-Za-z]/g, "").toUpperCase();
  const rc = (s) => H.reverseComplement(s);

  // ---------------------------------------------------------- site geometry

  // Where the annealed stretch starts and ends, 5' and 3' along the primer,
  // in template coordinates. The site object stores them as a plain span plus
  // which end the 3' terminus is, because that is what the renderer wants.
  const threePrime = (site) => site.threePrimeEnd;
  const fivePrime = (site) => (site.bottomStrand ? site.end : site.start);

  // Steps forward along the top strand from i to j. On a circle that is
  // always defined; on a line it can be negative, which is how "these primers
  // face the wrong way" shows up.
  function forwardSpan(i, j, n, isCircular) {
    const raw = j - i;
    if (!isCircular) return raw;
    return ((raw % n) + n) % n;
  }

  // ------------------------------------------------------- one pasted primer

  // The site a pasted primer is to be read at: the best real one, with
  // anything worth saying about the choice reported rather than buried.
  // `prefer` picks a strand when the oligo binds usably on both.
  function resolve(template, bases, { isCircular = false, params, prefer } = {}) {
    const primer = clean(bases);
    if (!primer) return { ok: false, reason: "no primer bases", sites: [] };
    const found = H.findSites(template, primer, { isCircular, params });
    // 5'-only sites cannot be extended, so they are not products
    let usable = found.sites.filter((s) => !s.fivePrimeOnly);
    if (prefer === "top") usable = usable.filter((s) => !s.bottomStrand);
    if (prefer === "bottom") usable = usable.filter((s) => s.bottomStrand);
    if (!usable.length) {
      return {
        ok: false,
        reason:
          found.reason ||
          (prefer
            ? `this primer does not bind the ${prefer === "top" ? "top" : "bottom"} strand of this template`
            : "this primer has no binding site on this template"),
        sites: found.sites,
      };
    }
    const site = usable[0];
    const equallyGood = usable.filter(
      (s) => s.mismatchCount === site.mismatchCount && s.annealLength === site.annealLength
    );
    return {
      ok: true,
      site,
      sites: usable,
      primer,
      ambiguous: equallyGood.length > 1 ? equallyGood.length : 0,
    };
  }

  // ------------------------------------------------------------- amplicon

  // The product of a pair, with the primers' own bases at both ends -- which
  // is what makes a mismatched base an edit rather than an error.
  //
  // Returns { sequence, fivePrimeOnTemplate, threePrimeOnTemplate, spanLength }
  // or { error }.
  function amplify(templateIn, fwd, rev, { isCircular = false } = {}) {
    const template = clean(templateIn);
    const n = template.length;
    if (!n) return { error: "no template" };
    if (fwd.site.bottomStrand || !rev.site.bottomStrand) {
      return { error: "both primers read along the same strand, so they cannot make a product" };
    }
    const from = threePrime(fwd.site);
    const to = threePrime(rev.site);
    // the stretch the polymerase copies, between the two 3' ends
    const between = forwardSpan(from, to, n, isCircular) - 1;
    if (between < 0) {
      return {
        error: isCircular
          ? "these primers point away from the product: their 3′ ends face apart"
          : "the reverse primer binds upstream of the forward primer, so they make no product",
      };
    }
    const mid = between > 0 ? sliceForward(template, from + 1, between, isCircular) : "";
    const sequence = clean(fwd.primer) + mid + rc(clean(rev.primer));
    return {
      sequence,
      fivePrimeOnTemplate: fivePrime(fwd.site),
      threePrimeOnTemplate: fivePrime(rev.site),
      spanLength: sequence.length,
    };
  }

  function sliceForward(template, start, length, isCircular) {
    const n = template.length;
    if (!isCircular) return template.slice(start, start + length);
    let out = "";
    for (let k = 0; k < length; k++) out += template[(start + k) % n];
    return out;
  }

  // ----------------------------------------------------------- mutagenesis

  // What changed, read off the two sequences rather than off the primer.
  //
  // The obvious route -- list the site's mismatches -- misses the commonest
  // case there is. A Q5 mutagenesis primer carries its change at or near the
  // 5' end, and the annealing region is grown 5'-ward only while bases keep
  // pairing, so a change at the very 5' end ends the annealing region instead
  // of being recorded as a mismatch within it. The mutant was still built
  // correctly, because the product takes the primer's bases; only the list of
  // what changed was empty. Comparing the mutant with the template cannot
  // miss it.
  //
  // `offset` is where the mutant's first base sits on the template, since a
  // KLD product is the plasmid reopened at the primers' join.
  function diffEdits(template, mutant, offset = 0) {
    const n = template.length;
    if (!n || mutant.length !== n) return null; // lengths differ: not a substitution set
    const out = [];
    for (let i = 0; i < n; i++) {
      const at = (i + offset) % n;
      if (template[at] !== mutant[i]) {
        out.push({ position: at + 1, from: template[at], to: mutant[i] });
      }
    }
    return out;
  }

  // The mismatches a single site records, for reporting one primer on its
  // own. Kept because it is the right answer for "what does this primer
  // disagree with", which is not the same question as "what does this pair
  // change".
  function editsOf(site) {
    return (site.mismatches || []).map((m) => ({
      position: m.templateIndex + 1, // 1-based, as the editor counts
      from: String(m.templateBase || "").toUpperCase(),
      to: String(m.base || "").toUpperCase(),
    }));
  }

  // Two layouts are in use and they build the mutant differently:
  //
  //   back-to-back (Q5 SDM, KLD)  the primers' 5' ends abut and they read
  //                               outwards; the product is the whole plasmid
  //                               linearised at that join, recircularised
  //   overlapping (QuikChange)    both primers cover the same window on
  //                               opposite strands; the mutant is the
  //                               template with that window replaced
  //
  // Anything else is reported rather than forced into one of them.
  function layoutOf(fwd, rev, n, isCircular) {
    const fFive = fivePrime(fwd.site);
    const rFive = fivePrime(rev.site);
    const fThree = threePrime(fwd.site);
    const rThree = threePrime(rev.site);
    // overlapping: the two annealed windows are the same stretch
    const sameWindow =
      Math.abs(fFive - rThree) <= 2 && Math.abs(fThree - rFive) <= 2 && fFive <= fThree;
    if (sameWindow) return "overlapping";
    // back-to-back: the reverse primer's 5' end sits just before the forward
    // primer's 5' end, the two reading away from each other
    const gap = forwardSpan(rFive, fFive, n, isCircular);
    if (isCircular && gap >= 0 && gap <= 2) return "back-to-back";
    return null;
  }

  // The whole job for a pasted mutagenesis pair: where they sit, what they
  // change, and the mutant plasmid.
  function mutagenesis({ sequence, isCircular = true, forward, reverse, params } = {}) {
    const template = clean(sequence);
    const problems = [];
    const out = { problems, ok: false };
    if (!template) {
      problems.push("There is no sequence to mutate.");
      return out;
    }
    const f = resolve(template, forward, { isCircular, params, prefer: "top" });
    const r = resolve(template, reverse, { isCircular, params, prefer: "bottom" });
    out.forward = f;
    out.reverse = r;
    if (!f.ok) problems.push(`Forward primer: ${f.reason}.`);
    if (!r.ok) problems.push(`Reverse primer: ${r.reason}.`);
    if (!f.ok || !r.ok) return out;
    if (f.ambiguous) problems.push(`The forward primer binds ${f.ambiguous} places equally well.`);
    if (r.ambiguous) problems.push(`The reverse primer binds ${r.ambiguous} places equally well.`);

    const layout = layoutOf(f, r, template.length, isCircular);
    out.layout = layout;

    if (!layout) {
      problems.push(
        "These primers are neither back-to-back (Q5 / KLD) nor overlapping (QuikChange), " +
          "so the mutant they make is not determined by this pair alone."
      );
      return out;
    }
    if (layout === "overlapping") {
      const start = fivePrime(f.site);
      const end = threePrime(f.site);
      out.sequence = template.slice(0, start) + f.primer + template.slice(end + 1);
      out.offset = 0;
    } else {
      const product = amplify(template, f, r, { isCircular });
      if (product.error) {
        problems.push(product.error);
        return out;
      }
      // KLD circularises the product; the sequence is the mutant plasmid read
      // from the forward primer's 5' end
      out.sequence = product.sequence;
      out.product = product;
      // Where the product's FIRST base sits on the template. Not the start of
      // the annealing region: a mutation at the primer's 5' end stops the
      // annealing region from reaching that far, so those bases are reported
      // as a "tail" even though they are the edit. Stepping back over them is
      // what lines the two sequences up.
      out.offset =
        (fivePrime(f.site) - (f.site.tailLength || 0) + template.length) % template.length;
    }
    out.ok = !!out.sequence;
    out.lengthChange = out.sequence ? out.sequence.length - template.length : 0;
    out.edits = out.lengthChange === 0 ? diffEdits(template, out.sequence, out.offset) || [] : [];
    if (out.ok && !out.lengthChange && !out.edits.length) {
      problems.push("Neither primer changes the template, so this pair rebuilds the same sequence.");
    }
    if (out.lengthChange) {
      problems.push(
        `This pair changes the length by ${out.lengthChange > 0 ? "+" : ""}${out.lengthChange} bp, ` +
          "so the change is an insertion or a deletion rather than a set of substitutions."
      );
    }
    return out;
  }

  function dedupeEdits(edits) {
    const seen = new Set();
    const out = [];
    edits.forEach((e) => {
      const key = `${e.position}:${e.from}:${e.to}`;
      if (seen.has(key)) return;
      seen.add(key);
      out.push(e);
    });
    return out.sort((a, b) => a.position - b.position);
  }

  // ---------------------------------------------------------------- Gibson

  // Each amplicon carries its own junctions: the forward primer's 5' tail is
  // the overlap with whatever comes before it, and the reverse primer's tail,
  // read on the top strand, is the overlap with whatever comes after. So the
  // order of an assembly is not something to ask the user for -- it is
  // written in the primers, and can be read back out.
  function overlapsOf(product, fwd, rev) {
    const left = clean(fwd.site.tail);
    const right = rc(clean(rev.site.tail));
    return { left, right, product };
  }

  // How much of the end of `a` is the start of `b`.
  //
  // Deliberately measured between the two products rather than read off the
  // primer's tail. The annealing region is grown 5'-ward for as long as the
  // bases keep pairing, so when the last base or two of a designed tail
  // happens to pair with the template as well -- which is common, there being
  // only four bases -- the "tail" the site reports is shorter than the tail
  // that was ordered. The junction is a property of the two products, so
  // measure it there and the question does not arise.
  // Low enough that an overlap too short to assemble on is still found and
  // reported as too short, rather than reported as no junction at all --
  // "your overlap is 8 nt" is a far more useful answer than "these do not
  // close a circle".
  const MIN_JUNCTION = 6;

  function overlapLength(a, b, min = MIN_JUNCTION) {
    const max = Math.min(a.length, b.length, 200);
    for (let k = max; k >= min; k--) {
      if (a.slice(a.length - k) === b.slice(0, k)) return k;
    }
    return 0;
  }

  // Which fragment can follow which.
  function follows(a, b) {
    return overlapLength(a.product, b.product) > 0;
  }

  // With 2-4 fragments the orders worth trying are few enough to walk, and a
  // brute-force search says plainly when none of them work -- which is the
  // answer an externally designed set most often needs.
  function orderFragments(frags, circular) {
    const n = frags.length;
    if (!n) return null;
    const rest = frags.map((f, i) => i).slice(1);
    const found = [];
    const walk = (chain, left) => {
      if (found.length) return; // first complete order wins; ambiguity is reported separately
      if (!left.length) {
        if (!circular || follows(frags[chain[chain.length - 1]], frags[chain[0]])) found.push(chain);
        return;
      }
      left.forEach((i) => {
        if (!follows(frags[chain[chain.length - 1]], frags[i])) return;
        walk(chain.concat([i]), left.filter((j) => j !== i));
      });
    };
    walk([0], rest);
    return found[0] || null;
  }

  // The assembled molecule: each overlap written once.
  function joinProducts(frags, order, circular) {
    let seq = frags[order[0]].product;
    for (let k = 1; k < order.length; k++) {
      const prev = frags[order[k - 1]];
      const f = frags[order[k]];
      seq += f.product.slice(overlapLength(prev.product, f.product));
    }
    if (circular) {
      const closing = overlapLength(frags[order[order.length - 1]].product, frags[order[0]].product);
      if (closing) seq = seq.slice(0, seq.length - closing);
    }
    return seq;
  }

  // The whole job for a set of pasted pairs: where each primer sits, what
  // each pair amplifies, which order the tails put them in, and the
  // construct. Fragments are { name, sequence, isCircular, forward, reverse }.
  function gibson({ fragments, circular = true, params, minOverlap = 15 } = {}) {
    const problems = [];
    const out = { problems, ok: false, fragments: [] };
    const list = Array.isArray(fragments) ? fragments.filter(Boolean) : [];
    if (list.length < 2) {
      problems.push("An assembly needs at least two fragments.");
      return out;
    }

    const built = [];
    list.forEach((frag, i) => {
      const label = frag.name || `Fragment ${i + 1}`;
      const template = clean(frag.sequence);
      const entry = { name: label, index: i };
      out.fragments.push(entry);
      if (!template) {
        problems.push(`${label}: no template to amplify.`);
        return;
      }
      const isCircular = !!frag.isCircular;
      const f = resolve(template, frag.forward, { isCircular, params, prefer: "top" });
      const r = resolve(template, frag.reverse, { isCircular, params, prefer: "bottom" });
      entry.forward = f;
      entry.reverse = r;
      if (!f.ok) problems.push(`${label}, forward primer: ${f.reason}.`);
      if (!r.ok) problems.push(`${label}, reverse primer: ${r.reason}.`);
      if (!f.ok || !r.ok) return;
      if (f.ambiguous) problems.push(`${label}: the forward primer binds ${f.ambiguous} places equally well.`);
      if (r.ambiguous) problems.push(`${label}: the reverse primer binds ${r.ambiguous} places equally well.`);
      const product = amplify(template, f, r, { isCircular });
      if (product.error) {
        problems.push(`${label}: ${product.error}.`);
        return;
      }
      const ov = overlapsOf(product.sequence, f, r);
      Object.assign(entry, ov, { amplicon: product, ok: true });
      built.push(entry);
    });

    if (built.length !== list.length) return out;

    const noLeft = built.filter((f) => !f.left);
    if (circular && noLeft.length) {
      noLeft.forEach((f) =>
        problems.push(`${f.name}: its forward primer has no 5′ tail, so nothing joins to it.`)
      );
      return out;
    }

    const order = orderFragments(built, circular);
    if (!order) {
      problems.push(
        circular
          ? "These fragments do not close a circle: at least one overlap matches no other fragment's end."
          : "These fragments do not chain: at least one overlap matches no other fragment's end."
      );
      // say which, rather than leaving it to be worked out
      built.forEach((b) => {
        if (!b.left) return;
        if (!built.some((a) => a !== b && follows(a, b))) {
          const shown = b.product.slice(0, Math.max(b.left.length, MIN_JUNCTION));
          problems.push(`${b.name}: its overlap (${shown.slice(0, 20)}${shown.length > 20 ? "…" : ""}) matches the end of no other fragment.`);
        }
      });
      return out;
    }

    out.order = order.map((i) => built[i].name);
    out.sequence = joinProducts(built, order, circular);
    out.circular = circular;
    out.junctions = order.map((idx, k) => {
      const a = built[idx];
      const b = built[order[(k + 1) % order.length]];
      const length = overlapLength(a.product, b.product);
      return { after: a.name, before: b.name, overlap: b.product.slice(0, length), length };
    });
    if (!circular) out.junctions = out.junctions.slice(0, order.length - 1);
    out.junctions.forEach((j) => {
      if (j.length < minOverlap) {
        problems.push(
          `${j.after} → ${j.before}: the overlap is ${j.length} nt, under the ${minOverlap} nt these assemblies usually want.`
        );
      }
    });
    out.ok = true;
    return out;
  }

  return {
    clean,
    overlapsOf,
    overlapLength,
    follows,
    orderFragments,
    joinProducts,
    gibson,
    threePrime,
    fivePrime,
    forwardSpan,
    resolve,
    amplify,
    editsOf,
    diffEdits,
    dedupeEdits,
    layoutOf,
    mutagenesis,
  };
});
