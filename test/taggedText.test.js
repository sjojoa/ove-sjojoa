const assert = require("assert");
const {
  parseTagged,
  renderTagged,
  looksTagged,
  taggedToSequenceData,
} = require("../src/features/taggedText");

const byName = (list, name) => list.find((f) => f.name === name);

describe("tagged text: parsing", () => {
  it("turns a tag pair into a feature and keeps the bases", () => {
    const r = parseTagged("aa[Tag]ccgg[/Tag]tt");
    assert.strictEqual(r.sequence, "aaccggtt");
    assert.deepStrictEqual(
      { start: r.features[0].start, end: r.features[0].end },
      { start: 2, end: 5 }
    );
    assert.strictEqual(r.features[0].type, "misc_feature");
    assert.strictEqual(r.features[0].strand, 1);
  });

  it("ignores whitespace and line breaks inside the sequence", () => {
    const r = parseTagged("[A]ac g\n  t[/A]\n");
    assert.strictEqual(r.sequence, "acgt");
    assert.deepStrictEqual([r.features[0].start, r.features[0].end], [0, 3]);
  });

  it("closes on a bare repeat of the name, not only on a slash", () => {
    const r = parseTagged("[A]aaa[A]ttt");
    assert.strictEqual(r.features.length, 1);
    assert.deepStrictEqual([r.features[0].start, r.features[0].end], [0, 2]);
  });

  it("reads a backslash on the OPENING tag as the reverse strand", () => {
    const r = parseTagged("[\\AmpR]acgt[AmpR]");
    assert.strictEqual(r.features[0].strand, -1);
    assert.match(r.warnings.join(" "), /reverse strand/);
  });

  it("leaves a normal [X]..[/X] pair on the forward strand", () => {
    assert.strictEqual(parseTagged("[X]acgt[/X]").features[0].strand, 1);
  });

  it("can be told not to treat a backslash as strand information", () => {
    const r = parseTagged("[\\AmpR]acgt[AmpR]", { backslashStrand: false });
    assert.strictEqual(r.features[0].strand, 1);
  });

  it("handles nested and overlapping features", () => {
    const r = parseTagged("[A]aa[B]bb[/A]cc[/B]");
    assert.deepStrictEqual(
      [byName(r.features, "A").start, byName(r.features, "A").end],
      [0, 3]
    );
    assert.deepStrictEqual(
      [byName(r.features, "B").start, byName(r.features, "B").end],
      [2, 5]
    );
  });

  it("reads attributes off the opening tag", () => {
    const r = parseTagged("[AmpR|type=CDS|dir=rev|color=#ff0000]acgt[/AmpR]");
    assert.strictEqual(r.features[0].type, "CDS");
    assert.strictEqual(r.features[0].strand, -1);
    assert.strictEqual(r.features[0].color, "#ff0000");
  });

  it("rebuilds #1/#2 segments as one multi-location feature", () => {
    const r = parseTagged("[Gene#1]aaa[/Gene#1]ttt[Gene#2]ccc[/Gene#2]");
    assert.strictEqual(r.features.length, 1);
    const f = r.features[0];
    assert.strictEqual(f.name, "Gene");
    assert.deepStrictEqual(f.locations, [
      { start: 0, end: 2 },
      { start: 6, end: 8 },
    ]);
    assert.deepStrictEqual([f.start, f.end], [0, 8]);
  });

  it("routes primer_bind annotations to primers, not features", () => {
    const r = parseTagged("[K193|type=primer_bind]acgt[/K193]");
    assert.strictEqual(r.features.length, 0);
    assert.strictEqual(r.primers[0].name, "K193");
  });

  it("reads the header and the topology", () => {
    const r = parseTagged("# name: pKR101\n# topology: circular\nacgt");
    assert.strictEqual(r.name, "pKR101");
    assert.strictEqual(r.circular, true);
    assert.strictEqual(r.sequence, "acgt");
  });

  it("drops an unclosed tag but says so", () => {
    const r = parseTagged("[A]aaa[B]ttt[/B]");
    assert.deepStrictEqual(r.features.map((f) => f.name), ["B"]);
    assert.match(r.warnings.join(" "), /"A" opened at base 1 was never closed/);
  });

  it("drops a tag that closes where it opened", () => {
    const r = parseTagged("acg[A][/A]t");
    assert.strictEqual(r.features.length, 0);
    assert.match(r.warnings.join(" "), /closed where it opened/);
  });

  it("warns about non-letter characters in the sequence", () => {
    assert.match(parseTagged("ac1gt").warnings.join(" "), /non-letter/);
  });

  it("ignores an empty tag", () => {
    const r = parseTagged("ac[]gt");
    assert.strictEqual(r.sequence, "acgt");
    assert.match(r.warnings.join(" "), /empty tag/);
  });

  it("builds sequence data OVE can open", () => {
    const { sequenceData } = taggedToSequenceData("# topology: circular\n[A]acgt[/A]");
    assert.strictEqual(sequenceData.circular, true);
    assert.strictEqual(sequenceData.sequence, "acgt");
    assert.strictEqual(sequenceData.features.length, 1);
  });
});

describe("tagged text: recognising the format", () => {
  it("accepts tagged text", () => {
    assert.ok(looksTagged("[AviTag]ggcatg[/AviTag][Linker]ggtggc[/Linker]"));
  });
  it("rejects genbank, fasta and raw bases", () => {
    assert.ok(!looksTagged("LOCUS       pKR101   1200 bp"));
    assert.ok(!looksTagged(">pKR101\nacgtacgt"));
    assert.ok(!looksTagged("acgtacgtacgt"));
    assert.ok(!looksTagged('{"sequence": "acgt"}'));
  });
});

describe("tagged text: rendering", () => {
  const seq = {
    name: "pKR101",
    circular: true,
    sequence: "aaacccgggttt",
    features: [
      { name: "A", type: "misc_feature", strand: 1, start: 0, end: 5 },
      { name: "B", type: "CDS", strand: -1, start: 3, end: 8 },
    ],
  };

  it("writes the header and the tags inline", () => {
    const { text } = renderTagged(seq);
    assert.match(text, /^# name: pKR101\n# topology: circular\n\n/);
    assert.ok(text.includes("[A]aaa[B|type=CDS|dir=rev]ccc[/A]ggg[/B]"));
  });

  it("omits defaults in minimal mode and writes them in full mode", () => {
    assert.ok(!renderTagged(seq).text.includes("[A|"));
    assert.ok(renderTagged(seq, { attrs: "full" }).text.includes("[A|type=misc_feature|dir=fwd]"));
  });

  it("closers come before openers at a shared position", () => {
    const { text } = renderTagged({
      sequence: "aabb",
      features: [
        { name: "A", start: 0, end: 1 },
        { name: "B", start: 2, end: 3 },
      ],
    });
    assert.ok(text.includes("[A]aa[/A][B]bb[/B]"));
  });

  it("writes a colour only when it differs from the type's own colour", () => {
    const typeColor = (t) => (t === "CDS" ? "#EF6500" : undefined);
    const same = renderTagged(
      { sequence: "acgt", features: [{ name: "F", type: "CDS", color: "#ef6500", start: 0, end: 3 }] },
      { typeColor }
    );
    const different = renderTagged(
      { sequence: "acgt", features: [{ name: "F", type: "CDS", color: "#123456", start: 0, end: 3 }] },
      { typeColor }
    );
    assert.ok(!same.text.includes("color="));
    assert.ok(different.text.includes("color=#123456"));
  });

  it("splits an origin-wrapping feature into numbered segments", () => {
    const { text } = renderTagged({
      sequence: "aaccggtt",
      circular: true,
      features: [{ name: "Ori", start: 6, end: 1 }],
    });
    assert.ok(text.includes("[Ori#2]aa[/Ori#2]"));
    assert.ok(text.includes("[Ori#1]tt[/Ori#1]"));
  });

  it("accepts the keyed objects a live editor holds, not just arrays", () => {
    const { text } = renderTagged({
      sequence: "acgtacgt",
      features: { f1: { id: "f1", name: "A", start: 0, end: 3 } },
      primers: { p1: { id: "p1", name: "K193", start: 4, end: 7 } },
    });
    assert.ok(text.includes("[A]acgt[/A]"));
    assert.ok(text.includes("[K193|type=primer_bind]acgt[/K193]"));
  });

  it("writes primers as primer_bind", () => {
    const { text } = renderTagged({
      sequence: "acgtacgt",
      primers: [{ name: "K193", start: 0, end: 3, strand: 1 }],
    });
    assert.ok(text.includes("[K193|type=primer_bind]acgt[/K193]"));
  });

  it("takes tag syntax out of a feature name and says so", () => {
    const { text, warnings } = renderTagged({
      sequence: "acgt",
      features: [{ name: "we[ird|na#me", start: 0, end: 3 }],
    });
    assert.ok(text.includes("[we_ird_na_me]"));
    assert.match(warnings.join(" "), /renamed/);
  });

  it("warns when two annotations share a name", () => {
    const { warnings } = renderTagged({
      sequence: "acgtacgt",
      features: [
        { name: "dup", start: 0, end: 1 },
        { name: "dup", start: 4, end: 5 },
      ],
    });
    assert.match(warnings.join(" "), /named "dup"/);
  });

  it("wraps the sequence when asked", () => {
    const { text } = renderTagged({ sequence: "aaaaaaaaaa" }, { wrap: 4 });
    assert.deepStrictEqual(text.trim().split("\n"), ["aaaa", "aaaa", "aa"]);
  });
});

describe("tagged text: round trip", () => {
  const original = {
    name: "pKR101",
    circular: true,
    sequence: "aaacccgggtttaaacccgggttt",
    features: [
      { name: "Promoter", type: "promoter", strand: 1, start: 0, end: 5 },
      { name: "AmpR", type: "CDS", strand: -1, start: 6, end: 17 },
      { name: "Spliced", type: "CDS", strand: 1, start: 18, end: 23,
        locations: [{ start: 18, end: 19 }, { start: 22, end: 23 }] },
    ],
  };

  it("map -> text -> map keeps names, types, strands and coordinates", () => {
    const { text } = renderTagged(original);
    const back = parseTagged(text);
    assert.strictEqual(back.sequence, original.sequence);
    assert.strictEqual(back.circular, true);
    assert.strictEqual(back.name, "pKR101");
    original.features.forEach((f) => {
      const got = byName(back.features, f.name);
      assert.ok(got, `${f.name} survived`);
      assert.strictEqual(got.type, f.type);
      assert.strictEqual(got.strand, f.strand);
      assert.strictEqual(got.start, f.start);
      assert.strictEqual(got.end, f.end);
    });
    assert.deepStrictEqual(byName(back.features, "Spliced").locations, [
      { start: 18, end: 19 },
      { start: 22, end: 23 },
    ]);
  });

  it("text -> map -> text comes back unchanged in full mode", () => {
    const start = "# name: pKR101\n# topology: circular\n\n[A|type=CDS|dir=rev|color=#123456]acgt[/A]ttt\n";
    const parsed = parseTagged(start);
    const { text } = renderTagged(
      {
        name: parsed.name,
        circular: parsed.circular,
        sequence: parsed.sequence,
        features: parsed.features,
      },
      { attrs: "full" }
    );
    assert.strictEqual(text, start);
  });

  it("the lab's backslash convention survives as dir=rev", () => {
    const parsed = parseTagged("[\\ColE1_ori]acgtacgt[ColE1_ori]");
    const { text } = renderTagged({ sequence: parsed.sequence, features: parsed.features });
    assert.ok(text.includes("dir=rev"));
    assert.strictEqual(parseTagged(text).features[0].strand, -1);
  });
});
