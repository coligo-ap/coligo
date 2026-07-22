/** Sonde Commons : node scripts/_commons-probe.mjs "requête" [limite] */
const UA = "coligo-seed/1.0 (https://coligo.dz; contact@coligo.dz)";
const q = process.argv[2];
const limit = Number(process.argv[3] ?? 12);
const u = new URL("https://commons.wikimedia.org/w/api.php");
u.searchParams.set("action", "query");
u.searchParams.set("format", "json");
u.searchParams.set("generator", "search");
u.searchParams.set("gsrsearch", `${q} filetype:bitmap`);
u.searchParams.set("gsrnamespace", "6");
u.searchParams.set("gsrlimit", String(limit));
u.searchParams.set("prop", "imageinfo");
u.searchParams.set("iiprop", "url|extmetadata|size|mime");
u.searchParams.set("iiurlwidth", "1400");
const j = await (await fetch(u, { headers: { "user-agent": UA } })).json();
const pages = Object.values(j.query?.pages ?? {}).sort(
  (a, b) => (a.index ?? 0) - (b.index ?? 0)
);
for (const p of pages) {
  const ii = p.imageinfo?.[0];
  if (!ii) continue;
  const lic =
    ii.extmetadata?.LicenseShortName?.value ?? ii.extmetadata?.License?.value;
  console.log(`${p.title} | ${ii.width}x${ii.height} | ${lic}`);
}
