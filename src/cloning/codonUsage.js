// Codon usage per species, for the table under Tools.
//
// Fractions are per amino acid: the six Leu codons sum to 1, not the whole
// table. Data from the Kazusa Codon Usage Database via
// Edinburgh-Genome-Foundry/python_codon_tables (CC0-1.0), which is counted
// over GenBank coding sequences -- a genome-wide average, not a guide to any
// one gene.
//
// Pure data plus one helper, so the table can be tested without a window.
(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (typeof root !== "undefined" && root.document) root.oveCodonUsage = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  const SPECIES = [
  {
    id: "human",
    label: "Homo sapiens (human)",
    taxid: 9606,
    codons: {
      AAA: 0.43, AAC: 0.53, AAG: 0.57, AAT: 0.47,
      ACA: 0.28, ACC: 0.36, ACG: 0.11, ACT: 0.25,
      AGA: 0.21, AGC: 0.24, AGG: 0.21, AGT: 0.15,
      ATA: 0.17, ATC: 0.47, ATG: 1.00, ATT: 0.36,
      CAA: 0.27, CAC: 0.58, CAG: 0.73, CAT: 0.42,
      CCA: 0.28, CCC: 0.32, CCG: 0.11, CCT: 0.29,
      CGA: 0.11, CGC: 0.18, CGG: 0.20, CGT: 0.08,
      CTA: 0.07, CTC: 0.20, CTG: 0.40, CTT: 0.13,
      GAA: 0.42, GAC: 0.54, GAG: 0.58, GAT: 0.46,
      GCA: 0.23, GCC: 0.40, GCG: 0.11, GCT: 0.27,
      GGA: 0.25, GGC: 0.34, GGG: 0.25, GGT: 0.16,
      GTA: 0.12, GTC: 0.24, GTG: 0.46, GTT: 0.18,
      TAA: 0.30, TAC: 0.56, TAG: 0.24, TAT: 0.44,
      TCA: 0.15, TCC: 0.22, TCG: 0.05, TCT: 0.19,
      TGA: 0.47, TGC: 0.54, TGG: 1.00, TGT: 0.46,
      TTA: 0.08, TTC: 0.54, TTG: 0.13, TTT: 0.46,
    },
  },
  {
    id: "mouse",
    label: "Mus musculus (mouse)",
    taxid: 10090,
    codons: {
      AAA: 0.39, AAC: 0.57, AAG: 0.61, AAT: 0.43,
      ACA: 0.29, ACC: 0.35, ACG: 0.10, ACT: 0.25,
      AGA: 0.22, AGC: 0.24, AGG: 0.22, AGT: 0.15,
      ATA: 0.16, ATC: 0.50, ATG: 1.00, ATT: 0.34,
      CAA: 0.26, CAC: 0.59, CAG: 0.74, CAT: 0.41,
      CCA: 0.29, CCC: 0.30, CCG: 0.10, CCT: 0.31,
      CGA: 0.12, CGC: 0.17, CGG: 0.19, CGT: 0.08,
      CTA: 0.08, CTC: 0.20, CTG: 0.39, CTT: 0.13,
      GAA: 0.41, GAC: 0.55, GAG: 0.59, GAT: 0.45,
      GCA: 0.23, GCC: 0.38, GCG: 0.09, GCT: 0.29,
      GGA: 0.26, GGC: 0.33, GGG: 0.23, GGT: 0.18,
      GTA: 0.12, GTC: 0.25, GTG: 0.46, GTT: 0.17,
      TAA: 0.28, TAC: 0.57, TAG: 0.23, TAT: 0.43,
      TCA: 0.14, TCC: 0.22, TCG: 0.05, TCT: 0.20,
      TGA: 0.49, TGC: 0.52, TGG: 1.00, TGT: 0.48,
      TTA: 0.07, TTC: 0.56, TTG: 0.13, TTT: 0.44,
    },
  },
  {
    id: "chicken",
    label: "Gallus gallus (chicken)",
    taxid: 9031,
    codons: {
      AAA: 0.44, AAC: 0.57, AAG: 0.56, AAT: 0.43,
      ACA: 0.30, ACC: 0.31, ACG: 0.14, ACT: 0.25,
      AGA: 0.22, AGC: 0.26, AGG: 0.21, AGT: 0.14,
      ATA: 0.18, ATC: 0.46, ATG: 1.00, ATT: 0.35,
      CAA: 0.27, CAC: 0.60, CAG: 0.73, CAT: 0.40,
      CCA: 0.28, CCC: 0.30, CCG: 0.14, CCT: 0.27,
      CGA: 0.10, CGC: 0.19, CGG: 0.18, CGT: 0.10,
      CTA: 0.06, CTC: 0.18, CTG: 0.41, CTT: 0.13,
      GAA: 0.43, GAC: 0.50, GAG: 0.57, GAT: 0.50,
      GCA: 0.26, GCC: 0.32, GCG: 0.13, GCT: 0.29,
      GGA: 0.27, GGC: 0.31, GGG: 0.25, GGT: 0.18,
      GTA: 0.12, GTC: 0.22, GTG: 0.45, GTT: 0.21,
      TAA: 0.32, TAC: 0.60, TAG: 0.20, TAT: 0.40,
      TCA: 0.15, TCC: 0.20, TCG: 0.07, TCT: 0.18,
      TGA: 0.47, TGC: 0.60, TGG: 1.00, TGT: 0.40,
      TTA: 0.08, TTC: 0.55, TTG: 0.13, TTT: 0.45,
    },
  },
  {
    id: "fly",
    label: "Drosophila melanogaster (fruit fly)",
    taxid: 7227,
    codons: {
      AAA: 0.30, AAC: 0.56, AAG: 0.70, AAT: 0.44,
      ACA: 0.20, ACC: 0.38, ACG: 0.26, ACT: 0.17,
      AGA: 0.09, AGC: 0.25, AGG: 0.11, AGT: 0.14,
      ATA: 0.19, ATC: 0.47, ATG: 1.00, ATT: 0.34,
      CAA: 0.30, CAC: 0.60, CAG: 0.70, CAT: 0.40,
      CCA: 0.25, CCC: 0.33, CCG: 0.29, CCT: 0.13,
      CGA: 0.15, CGC: 0.33, CGG: 0.15, CGT: 0.16,
      CTA: 0.09, CTC: 0.15, CTG: 0.43, CTT: 0.10,
      GAA: 0.33, GAC: 0.47, GAG: 0.67, GAT: 0.53,
      GCA: 0.17, GCC: 0.45, GCG: 0.19, GCT: 0.19,
      GGA: 0.29, GGC: 0.43, GGG: 0.07, GGT: 0.21,
      GTA: 0.11, GTC: 0.24, GTG: 0.47, GTT: 0.19,
      TAA: 0.41, TAC: 0.63, TAG: 0.33, TAT: 0.37,
      TCA: 0.09, TCC: 0.24, TCG: 0.20, TCT: 0.08,
      TGA: 0.25, TGC: 0.71, TGG: 1.00, TGT: 0.29,
      TTA: 0.05, TTC: 0.62, TTG: 0.18, TTT: 0.38,
    },
  },
  {
    id: "worm",
    label: "Caenorhabditis elegans (nematode)",
    taxid: 6239,
    codons: {
      AAA: 0.59, AAC: 0.38, AAG: 0.41, AAT: 0.62,
      ACA: 0.34, ACC: 0.18, ACG: 0.15, ACT: 0.32,
      AGA: 0.29, AGC: 0.10, AGG: 0.08, AGT: 0.15,
      ATA: 0.16, ATC: 0.31, ATG: 1.00, ATT: 0.53,
      CAA: 0.66, CAC: 0.39, CAG: 0.34, CAT: 0.61,
      CCA: 0.53, CCC: 0.09, CCG: 0.20, CCT: 0.18,
      CGA: 0.23, CGC: 0.10, CGG: 0.09, CGT: 0.21,
      CTA: 0.09, CTC: 0.17, CTG: 0.14, CTT: 0.25,
      GAA: 0.62, GAC: 0.32, GAG: 0.38, GAT: 0.68,
      GCA: 0.31, GCC: 0.20, GCG: 0.13, GCT: 0.36,
      GGA: 0.59, GGC: 0.12, GGG: 0.08, GGT: 0.20,
      GTA: 0.16, GTC: 0.22, GTG: 0.23, GTT: 0.39,
      TAA: 0.43, TAC: 0.44, TAG: 0.18, TAT: 0.56,
      TCA: 0.26, TCC: 0.13, TCG: 0.15, TCT: 0.21,
      TGA: 0.39, TGC: 0.45, TGG: 1.00, TGT: 0.55,
      TTA: 0.11, TTC: 0.51, TTG: 0.23, TTT: 0.49,
    },
  },
  {
    id: "yeast",
    label: "Saccharomyces cerevisiae (budding yeast)",
    taxid: 4932,
    codons: {
      AAA: 0.58, AAC: 0.41, AAG: 0.42, AAT: 0.59,
      ACA: 0.30, ACC: 0.22, ACG: 0.14, ACT: 0.35,
      AGA: 0.48, AGC: 0.11, AGG: 0.21, AGT: 0.16,
      ATA: 0.27, ATC: 0.26, ATG: 1.00, ATT: 0.46,
      CAA: 0.69, CAC: 0.36, CAG: 0.31, CAT: 0.64,
      CCA: 0.42, CCC: 0.15, CCG: 0.12, CCT: 0.31,
      CGA: 0.07, CGC: 0.06, CGG: 0.04, CGT: 0.14,
      CTA: 0.14, CTC: 0.06, CTG: 0.11, CTT: 0.13,
      GAA: 0.70, GAC: 0.35, GAG: 0.30, GAT: 0.65,
      GCA: 0.29, GCC: 0.22, GCG: 0.11, GCT: 0.38,
      GGA: 0.22, GGC: 0.19, GGG: 0.12, GGT: 0.47,
      GTA: 0.21, GTC: 0.21, GTG: 0.19, GTT: 0.39,
      TAA: 0.47, TAC: 0.44, TAG: 0.23, TAT: 0.56,
      TCA: 0.21, TCC: 0.16, TCG: 0.10, TCT: 0.26,
      TGA: 0.30, TGC: 0.37, TGG: 1.00, TGT: 0.63,
      TTA: 0.28, TTC: 0.41, TTG: 0.29, TTT: 0.59,
    },
  },
  {
    id: "ecoli",
    label: "Escherichia coli K-12",
    taxid: 316407,
    codons: {
      AAA: 0.76, AAC: 0.55, AAG: 0.24, AAT: 0.45,
      ACA: 0.13, ACC: 0.44, ACG: 0.27, ACT: 0.16,
      AGA: 0.04, AGC: 0.28, AGG: 0.02, AGT: 0.15,
      ATA: 0.07, ATC: 0.42, ATG: 1.00, ATT: 0.51,
      CAA: 0.35, CAC: 0.43, CAG: 0.65, CAT: 0.57,
      CCA: 0.19, CCC: 0.12, CCG: 0.53, CCT: 0.16,
      CGA: 0.06, CGC: 0.40, CGG: 0.10, CGT: 0.38,
      CTA: 0.04, CTC: 0.10, CTG: 0.50, CTT: 0.10,
      GAA: 0.69, GAC: 0.37, GAG: 0.31, GAT: 0.63,
      GCA: 0.21, GCC: 0.27, GCG: 0.36, GCT: 0.16,
      GGA: 0.11, GGC: 0.41, GGG: 0.15, GGT: 0.34,
      GTA: 0.15, GTC: 0.22, GTG: 0.37, GTT: 0.26,
      TAA: 0.64, TAC: 0.43, TAG: 0.07, TAT: 0.57,
      TCA: 0.12, TCC: 0.15, TCG: 0.15, TCT: 0.15,
      TGA: 0.29, TGC: 0.56, TGG: 1.00, TGT: 0.44,
      TTA: 0.13, TTC: 0.43, TTG: 0.13, TTT: 0.57,
    },
  },
  {
    id: "bsubtilis",
    label: "Bacillus subtilis",
    taxid: 1423,
    codons: {
      AAA: 0.70, AAC: 0.44, AAG: 0.30, AAT: 0.56,
      ACA: 0.40, ACC: 0.17, ACG: 0.27, ACT: 0.16,
      AGA: 0.25, AGC: 0.23, AGG: 0.10, AGT: 0.11,
      ATA: 0.13, ATC: 0.37, ATG: 1.00, ATT: 0.49,
      CAA: 0.52, CAC: 0.32, CAG: 0.48, CAT: 0.68,
      CCA: 0.19, CCC: 0.09, CCG: 0.44, CCT: 0.28,
      CGA: 0.10, CGC: 0.20, CGG: 0.17, CGT: 0.18,
      CTA: 0.05, CTC: 0.11, CTG: 0.24, CTT: 0.23,
      GAA: 0.68, GAC: 0.36, GAG: 0.32, GAT: 0.64,
      GCA: 0.28, GCC: 0.22, GCG: 0.26, GCT: 0.24,
      GGA: 0.31, GGC: 0.34, GGG: 0.16, GGT: 0.19,
      GTA: 0.20, GTC: 0.26, GTG: 0.26, GTT: 0.28,
      TAA: 0.61, TAC: 0.35, TAG: 0.15, TAT: 0.65,
      TCA: 0.23, TCC: 0.13, TCG: 0.10, TCT: 0.20,
      TGA: 0.24, TGC: 0.54, TGG: 1.00, TGT: 0.46,
      TTA: 0.21, TTC: 0.32, TTG: 0.16, TTT: 0.68,
    },
  },
  ];

  const byId = (id) => SPECIES.find((s) => s.id === id) || SPECIES[0];

  // The codon each amino acid uses most often, as {codon: true}. Ties keep
  // every codon that reaches the maximum, which is what the data says.
  function favourites(codons, codonToAa) {
    const topPerAa = {};
    Object.keys(codons).forEach((c) => {
      const aa = codonToAa[c];
      if (aa === undefined) return;
      if (topPerAa[aa] === undefined || codons[c] > topPerAa[aa]) topPerAa[aa] = codons[c];
    });
    const out = {};
    Object.keys(codons).forEach((c) => {
      const aa = codonToAa[c];
      if (aa !== undefined && codons[c] === topPerAa[aa]) out[c] = true;
    });
    return out;
  }

  return { SPECIES, byId, favourites };
});
