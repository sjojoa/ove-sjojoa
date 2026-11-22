// Who sells which enzyme, so the table can lead each row with the name you
// would actually order.
//
// An enzyme has a dozen isoschizomers under a dozen names, and which one is
// "the" name depends on whose catalogue you buy from. Supplier letters per
// enzyme, from REBASE (rebase.neb.com, Roberts et al., free for academic
// use), kept to the 564 enzymes that both have a supplier and exist in this
// app's enzyme database.
(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (typeof root !== "undefined" && root.document) root.oveEnzymeVendors = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  const VENDORS = {
    B: "Thermo Fisher Scientific",
    E: "Agilent Technologies",
    I: "SibEnzyme Ltd.",
    J: "Nippon Gene Co., Ltd.",
    K: "Takara Bio Inc.",
    M: "Roche Custom Biotech",
    N: "New England Biolabs",
    O: "Toyobo Biochemicals",
    Q: "Molecular Biology Resources - CHIMERx",
    R: "Promega Corporation",
    S: "Sigma Chemical Corporation",
    V: "Vivantis Technologies",
    X: "EURx Ltd.",
    Z: "Enzynomics",  };

  // enzyme name (lowercase) -> letters of the suppliers selling it
  const SUPPLIERS = {
    "aani": "B", "aari": "B", "aatii": "BINRVZ", "absi": "I", "acc16i": "IV",
    "acc36i": "I", "acc65i": "BINRV", "accb1i": "IV", "accb7i": "IRV", "accbsi": "IV",
    "acci": "JNQRVXZ", "accii": "J", "acciii": "JRZ", "acii": "N", "acli": "INVZ",
    "aclwi": "I", "acoi": "I", "acsi": "IV", "acui": "INZ", "acvi": "QX",
    "acyi": "JV", "adei": "B", "afei": "IN", "afii": "V", "aflii": "JNZ",
    "afliii": "N", "agei": "JNRSVZ", "agsi": "I", "ahdi": "NV", "ahli": "IV",
    "ajii": "B", "ajni": "I", "ajui": "B", "alei": "IN", "alfi": "B",
    "aloi": "B", "alubi": "I", "alui": "BIJNQRVX", "alw21i": "BV", "alw26i": "BVZ",
    "alw44i": "BJRV", "alwi": "NZ", "alwni": "N", "ama87i": "IV", "aor13hi": "V",
    "apai": "BIJNQRVXZ", "apali": "NSVZ", "apeki": "N", "apoi": "NVZ", "arsi": "I",
    "asci": "NSZ", "asei": "JNV", "asigi": "IV", "asisi": "IN", "aspa2i": "IV",
    "aspei": "V", "asplei": "IV", "asps9i": "IV", "asuc2i": "I", "asuhpi": "IV",
    "asuii": "V", "asunhi": "IV", "avai": "JNQRVXZ", "avaii": "JNRVXZ", "aviii": "V",
    "avrii": "NSVXZ", "axyi": "J", "baegi": "N", "baei": "N", "bali": "JQRVXZ",
    "bamhi": "BIJNQRSVXZ", "bani": "NRV", "banii": "NRVX", "bari": "I", "baui": "B",
    "bbrpi": "V", "bbsi": "NV", "bbui": "R", "bbv12i": "I", "bbvci": "NZ",
    "bbvi": "NZ", "bcci": "N", "bceai": "N", "bcgi": "N", "bcivi": "N",
    "bcli": "BJNRSVZ", "bcni": "B", "bcodi": "N", "bcui": "B", "bfai": "N",
    "bfmi": "B", "bfuai": "N", "bfui": "B", "bgli": "BIJNQRXZ", "bglii": "BIJNQRSXZ",
    "blpi": "NV", "blsi": "I", "bmcai": "V", "bme1390i": "B", "bme18i": "IV",
    "bmeri": "V", "bmgbi": "N", "bmii": "V", "bmrfi": "V", "bmri": "N",
    "bmti": "INV", "bmui": "I", "bmyi": "V", "boxi": "BV", "bpii": "B",
    "bpli": "B", "bpmi": "IN", "bpu10i": "BINV", "bpu1102i": "B", "bpu14i": "IV",
    "bpuei": "N", "bpumi": "V", "bsa29i": "I", "bsaai": "NV", "bsabi": "NV",
    "bsahi": "NV", "bsai": "NSVZ", "bsaji": "N", "bsami": "RV", "bsawi": "NZ",
    "bsaxi": "N", "bsc4i": "IV", "bse118i": "IV", "bse1i": "IV", "bse21i": "I",
    "bse3di": "I", "bse8i": "IV", "bsebi": "V", "bsedi": "B", "bsegi": "B",
    "bseji": "B", "bseli": "B", "bsemi": "B", "bsemii": "B", "bseni": "B",
    "bsepi": "IV", "bseri": "N", "bsesi": "B", "bsex3i": "IV", "bsexi": "B",
    "bseyi": "N", "bsgi": "N", "bsh1236i": "B", "bsh1285i": "B", "bshni": "B",
    "bshti": "B", "bshvi": "V", "bsiei": "NV", "bsihkai": "NV", "bsihkci": "QX",
    "bsiwi": "NZ", "bslfi": "I", "bsli": "NVZ", "bsmai": "NV", "bsmbi": "NSZ",
    "bsmfi": "N", "bsmi": "JNV", "bsni": "V", "bso31i": "IV", "bsobi": "NZ",
    "bsp119i": "B", "bsp120i": "B", "bsp1286i": "JNR", "bsp13i": "IV", "bsp1407i": "B",
    "bsp143i": "BV", "bsp1720i": "IV", "bsp19i": "IV", "bsp68i": "B", "bspaci": "I",
    "bspcni": "N", "bspdi": "N", "bspei": "NVZ", "bspfni": "I", "bsphi": "NXZ",
    "bspli": "B", "bspmi": "N", "bspoi": "B", "bsppi": "B", "bspqi": "KNZ",
    "bspti": "B", "bsrbi": "NV", "bsrdi": "NV", "bsrfi": "NZ", "bsrgi": "NS",
    "bsri": "NV", "bsrsi": "R", "bsseci": "I", "bsshii": "JNQRVX", "bssmi": "V",
    "bssnai": "IV", "bssni": "V", "bsssi": "N", "bsst1i": "IV", "bst1107i": "BV",
    "bst2bi": "I", "bst2ui": "IV", "bst4ci": "IV", "bst6i": "IV", "bst98i": "RV",
    "bstaci": "I", "bstafi": "I", "bstapi": "IN", "bstaui": "IV", "bstbai": "IV",
    "bstbi": "NS", "bstc8i": "I", "bstdei": "IV", "bstdsi": "IV", "bsteii": "JNRSV",
    "bsteni": "IV", "bstf5i": "I", "bstfi": "V", "bstfni": "IV", "bsth2i": "IV",
    "bsthhi": "IV", "bstkti": "I", "bstmai": "IV", "bstmbi": "IV", "bstmci": "IV",
    "bstmwi": "I", "bstni": "NV", "bstnsi": "IV", "bstoi": "R", "bstpai": "IV",
    "bstsci": "I", "bstsfi": "I", "bstsli": "I", "bstsni": "IV", "bstui": "NV",
    "bstv1i": "I", "bstv2i": "IV", "bstx2i": "IV", "bstxi": "BIJNQRVX", "bstyi": "NZ",
    "bstz17i": "N", "bstzi": "R", "bsu15i": "B", "bsu36i": "NR", "bsuri": "BIV",
    "btgi": "N", "btgzi": "N", "btri": "I", "btsci": "NZ", "btsi": "N",
    "btumi": "V", "bvei": "B", "cac8i": "N", "caii": "B", "ccii": "I",
    "ccini": "IV", "celii": "V", "cfoi": "R", "cfr10i": "BVZ", "cfr13i": "BV",
    "cfr42i": "BVZ", "cfr9i": "BZ", "clai": "NQRSVXZ", "cpoi": "B", "csei": "B",
    "csp45i": "R", "csp6i": "B", "cspci": "N", "cspi": "R", "cviai": "Z",
    "cviji": "QX", "cviki-1": "N", "cviqi": "N", "ddei": "NQRVXZ", "dini": "V",
    "dpni": "BENOQRSXZ", "dpnii": "NSZ", "drai": "BIJNQRSVXZ", "draiii": "INV", "drdi": "N",
    "drii": "I", "dsai": "V", "dsedi": "IV", "eaei": "N", "eagi": "NSVZ",
    "eam1104i": "B", "eam1105i": "BV", "eari": "NV", "ecii": "N", "ecl136ii": "B",
    "eclhki": "R", "eco105i": "B", "eco130i": "B", "eco147i": "B", "eco24i": "B",
    "eco31i": "BV", "eco32i": "B", "eco47i": "BZ", "eco47iii": "BRS", "eco52i": "B",
    "eco53ki": "N", "eco57i": "B", "eco72i": "B", "eco81i": "B", "eco88i": "B",
    "eco91i": "B", "ecoicri": "IRV", "econi": "NVZ", "ecoo109i": "BJNZ", "ecori": "BIJNQRSVXZ",
    "ecorii": "BJSV", "ecorv": "IJNQRSVXZ", "ecot38i": "JZ", "egei": "IV", "ehei": "B",
    "erhi": "I", "esp3i": "BNSZ", "faei": "I", "faii": "I", "fali": "I",
    "faqi": "B", "fati": "IN", "faui": "IN", "faundi": "IV", "fbli": "I",
    "fnu4hi": "N", "foki": "IJNVXZ", "frioi": "IV", "fsei": "NZ", "fsp4hi": "I",
    "fspai": "B", "fspbi": "B", "fspi": "JNSZ", "glai": "I", "glui": "I",
    "gsai": "I", "gsui": "B", "haeii": "JNRVZ", "haeiii": "IJNQRVXZ", "hgai": "INZ",
    "hhai": "BJNQRVX", "hin1i": "BV", "hin1ii": "B", "hin6i": "B", "hincii": "BJNQRVXZ",
    "hindii": "IZ", "hindiii": "BIJNQRSVXZ", "hinfi": "BIJNQRSVXZ", "hinp1i": "NZ", "hpai": "IJNQRSVXZ",
    "hpaii": "BINQRSVXZ", "hphi": "BNVZ", "hpy166ii": "N", "hpy188i": "NZ", "hpy188iii": "N",
    "hpy8i": "B", "hpy99i": "NZ", "hpyav": "N", "hpych4iii": "N", "hpych4iv": "N",
    "hpych4v": "NZ", "hpyf10vi": "B", "hpyf3i": "B", "hsp92i": "R", "hsp92ii": "R",
    "hspai": "IV", "kasi": "NZ", "kpn2i": "BZ", "kpni": "BIJNQRSVXZ", "ksp22i": "IV",
    "kspai": "BV", "kspi": "S", "kzo9i": "IV", "lgui": "B", "lsp1109i": "BZ",
    "lwei": "B", "mabi": "I", "mali": "I", "mami": "V", "maubi": "B",
    "mbii": "BV", "mboi": "BNQRVXZ", "mboii": "BIJNQRVXZ", "mfei": "IN", "mhli": "IV",
    "mlsi": "BV", "mluci": "N", "mlui": "BIJNQRSVXZ", "mly113i": "I", "mlyi": "N",
    "mmei": "N", "mnli": "BINQSVXZ", "mph1103i": "B", "mrei": "B", "mroi": "V",
    "mroni": "IV", "mroxi": "IV", "msci": "N", "msei": "NVZ", "msli": "N",
    "msp20i": "V", "mspa1i": "INRVZ", "mspi": "BIJNQRSVXZ", "mspr9i": "I", "mssi": "B",
    "muni": "BZ", "mva1269i": "B", "mvai": "B", "mwoi": "N", "naei": "NRZ",
    "nari": "JNQRVX", "ncii": "JNRV", "ncoi": "BJNQRSVXZ", "ndei": "BJNQRSVXZ", "ndeii": "JR",
    "ngomiv": "NZ", "nhei": "BJNQRVXZ", "nlaiii": "N", "nlaiv": "NVZ", "nmeaiii": "N",
    "nmuci": "B", "noti": "BJNQRSVXZ", "nrui": "IJNQRSVXZ", "nsbi": "B", "nsii": "JNQRSVX",
    "nspi": "NV", "nspv": "J", "olii": "B", "paci": "BNS", "paei": "B",
    "paer7i": "NVZ", "pagi": "B", "palai": "I", "pasi": "B", "paui": "B",
    "pcei": "IV", "pcii": "IN", "pcisi": "I", "pcti": "I", "pdii": "B",
    "pdmi": "B", "pfei": "B", "pfl23ii": "B", "pflfi": "NV", "pflmi": "NVZ",
    "pfoi": "B", "pinai": "QVX", "ple19i": "I", "plei": "NZ", "pmei": "NS",
    "pmli": "NV", "ppsi": "I", "ppu21i": "B", "ppumi": "N", "psci": "B",
    "pshai": "NV", "psii": "IN", "psp124bi": "IV", "psp1406i": "B", "psp5ii": "B",
    "psp6i": "I", "pspci": "IV", "pspei": "IV", "pspgi": "NSZ", "pspli": "I",
    "pspn4i": "I", "pspomi": "INV", "pspppi": "I", "pspxi": "IN", "psri": "I",
    "psti": "BIJNQRSVXZ", "psui": "B", "psyi": "B", "pvui": "BNQRXZ", "pvuii": "BIJNQRSVXZ",
    "rgai": "I", "rigi": "I", "rsai": "BIJNQRVXZ", "rsani": "I", "rsei": "B",
    "rsr2i": "IV", "rsrii": "NQX", "saci": "BJNQRSVXZ", "sacii": "JQRSVXZ", "sali": "BIJNQRSVXZ",
    "sapi": "N", "sati": "B", "sau3ai": "JNRVX", "sau96i": "JNVZ", "sbfi": "INSVZ",
    "scai": "BJNQRVXZ", "schi": "B", "scrfi": "JNVX", "sdai": "BVZ", "sdui": "B",
    "seti": "I", "sexai": "N", "sfaai": "B", "sfani": "INV", "sfci": "N",
    "sfii": "BIJNQRSVXZ", "sfoi": "NV", "sfr274i": "IV", "sfr303i": "IV", "sfui": "V",
    "sgfi": "R", "sgrai": "NZ", "sgrdi": "B", "sgsi": "B", "sini": "R",
    "smai": "BIJNQRSVXZ", "smii": "BIV", "smimi": "IV", "smli": "N", "smoi": "B",
    "snabi": "NRZ", "spei": "JNQRVXZ", "sphi": "IJNQRSVXZ", "srfi": "N", "sse9i": "IVZ",
    "ssii": "B", "sspdi": "B", "sspi": "BIJNQRSVXZ", "stui": "JNQRSXZ", "styd4i": "NZ",
    "styi": "JNR", "swai": "JNZ", "taai": "B", "taii": "B", "taqi": "BIJNQRVXZ",
    "taqii": "QX", "tasi": "BV", "tati": "B", "taui": "B", "tfii": "N",
    "tru1i": "B", "tru9i": "IRV", "tscai": "B", "tsei": "N", "tsp45i": "N",
    "tspdti": "QX", "tspgwi": "QX", "tspmi": "NZ", "tspri": "N", "tth111i": "INQRVXZ",
    "van91i": "BV", "vha464i": "V", "vnei": "IV", "vspi": "BIRV", "xagi": "BV",
    "xapi": "BV", "xbai": "BIJMNQRSVXZ", "xcei": "BV", "xcmi": "NZ", "xhoi": "BJNQRVXZ",
    "xhoii": "RV", "xmaci": "V", "xmai": "INRVZ", "xmaji": "BV", "xmii": "BV",
    "xmni": "NRV", "zrai": "INV", "zrmi": "IV", "zsp2i": "V",  };

  const sells = (vendorCode, name) =>
    !vendorCode || (SUPPLIERS[String(name).toLowerCase()] || "").includes(vendorCode);

  const vendorsFor = (name) =>
    [...(SUPPLIERS[String(name).toLowerCase()] || "")].map((c) => VENDORS[c]).filter(Boolean);

  const VENDOR_LIST = Object.keys(VENDORS)
    .map((code) => ({ code, name: VENDORS[code] }))
    .sort((a, b) => a.name.localeCompare(b.name));

  return { VENDORS, SUPPLIERS, VENDOR_LIST, sells, vendorsFor };
});
