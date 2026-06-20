import { CDP, findYassirPage, listTargets } from "./cdp.mjs";

const t = await findYassirPage();
if (!t) {
  console.log("Aucune page Yassir trouvée. Targets pages:");
  (await listTargets())
    .filter((x) => x.type === "page")
    .forEach((x) => console.log(" -", x.url));
  process.exit(0);
}
console.log("page Yassir:", t.url);
const cdp = await CDP.attach(t.webSocketDebuggerUrl);
await cdp.send("Runtime.enable");
const r = await cdp.send("Runtime.evaluate", {
  expression: `(() => {
    const ls = {};
    for (let i=0;i<localStorage.length;i++){const k=localStorage.key(i); ls[k]=String(localStorage.getItem(k)).slice(0,80);}
    return JSON.stringify({ url: location.href, lsKeys: Object.keys(ls), ls });
  })()`,
  returnByValue: true,
});
console.log(JSON.stringify(JSON.parse(r.result.value), null, 2).slice(0, 2500));
cdp.close();
process.exit(0);
