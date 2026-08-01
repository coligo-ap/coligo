/**
 * Styles de la page « Mon portefeuille » — port FIDÈLE de la maquette
 * MAQUETTE-recharge-portefeuille.html, scopé sous `.cgw` pour cohabiter avec
 * les thèmes des espaces hôtes (livreur / chauffeur / commerçant).
 *
 * Mode sombre : aligné EXACTEMENT sur les espaces qui basculent réellement en
 * sombre (cf. globals.css) — livreur (`[data-space="driver"].dark`) et
 * chauffeur/Drive + client (`.theme-dark` sur `.drive-jakarta` / client). Les
 * espaces commerçant et PARTENAIRE (agent Coligo Pay) sont clair-uniquement :
 * `.cgw` y reste donc clair, même si le cookie global `coligo_theme=dark` est
 * posé (sinon : bloc portefeuille sombre dans une page claire — incohérence
 * vécue côté agent). Aucune détection JS, la cascade CSS s'en charge.
 */
export const RECHARGE_STYLE = `
.cgw{
  --violet:#6C2BD9;--violet-l:#8A4DFF;--violet-d:#4B1FA6;--violet-soft:#F1E9FC;--violet-glow:rgba(108,43,217,.42);
  --cyan:#5BE0FF;--rose:#FF2D7A;
  --go:#16B364;--go-soft:rgba(22,179,100,.12);--red:#E5484D;
  --surface:#fff;--ink:#0C0D14;--muted:#878CA0;--line:#ECEEF4;--soft:#F5F6FB;
  --sh-s:0 8px 22px -12px rgba(20,22,45,.2);--sh-m:0 18px 44px -20px rgba(20,22,45,.3);
  --sora:var(--font-display),'Sora',system-ui,sans-serif;
  --jakarta:var(--font-sans-body),'Plus Jakarta Sans',system-ui,sans-serif;
  font-family:var(--jakarta);color:var(--ink);
  display:block;width:100%;max-width:360px;margin:0 auto;
  -webkit-tap-highlight-color:transparent;
}
[data-space="driver"].dark .cgw,
.theme-dark :is([data-space="client"], .drive-jakarta) .cgw{
  --surface:#14161f;--ink:#fff;--muted:#979BB0;--line:#23263a;--soft:#1b1e2b;--violet-soft:#2a1c44;
  --sh-s:0 8px 22px -10px rgba(0,0,0,.6);--sh-m:0 18px 44px -16px rgba(0,0,0,.7);
}
.cgw *{box-sizing:border-box}
.cgw [dir]{direction:inherit}

.cgw .ph1{font-family:var(--sora);font-weight:800;font-size:21px;letter-spacing:-.5px;margin:6px 2px 14px}

/* HERO */
.cgw .hero{position:relative;border-radius:26px;padding:20px;color:#fff;overflow:hidden;background:linear-gradient(135deg,#8A3DE8,#6C2BD9 52%,#4B1FA6);box-shadow:0 20px 40px -18px var(--violet-glow)}
.cgw .hero::after{content:"";position:absolute;right:-40px;top:-80px;width:210px;height:210px;border-radius:50%;background:radial-gradient(circle,rgba(91,224,255,.55),transparent 68%)}
.cgw .hero::before{content:"";position:absolute;left:-50px;bottom:-90px;width:180px;height:180px;border-radius:50%;background:radial-gradient(circle,rgba(255,45,122,.40),transparent 68%)}
.cgw .hero .top{display:flex;align-items:center;gap:11px;position:relative;z-index:1}
.cgw .hero .wic{width:42px;height:42px;border-radius:13px;background:rgba(255,255,255,.18);backdrop-filter:blur(6px);display:flex;align-items:center;justify-content:center;flex:none}
.cgw .hero .wic svg{width:21px;height:21px;stroke:#fff}
.cgw .hero .lbl{font-size:12.5px;opacity:.85;font-weight:600}
.cgw .hero .ptag{margin-inline-start:auto;font-size:11px;font-weight:800;background:rgba(255,255,255,.2);padding:5px 12px;border-radius:20px;display:flex;align-items:center;gap:6px}
.cgw .hero .amt{font-family:var(--sora);font-weight:800;font-size:40px;letter-spacing:-1.5px;margin:12px 0 2px;position:relative;z-index:1}
.cgw .hero .amt small{font-size:20px;opacity:.8;font-weight:700}
.cgw .hero .ctx{position:relative;z-index:1;display:flex;gap:9px;align-items:flex-start;margin-top:14px;padding-top:14px;border-top:1px solid rgba(255,255,255,.18);font-size:11.5px;line-height:1.45;opacity:.92}
.cgw .hero .ctx svg{width:15px;height:15px;stroke:#fff;flex:none;margin-top:1px}

/* sélecteur de méthode */
.cgw .secT{font-weight:800;font-size:14px;margin:22px 2px 11px;font-family:var(--sora)}
.cgw .methods{display:flex;gap:9px}
.cgw .m{flex:1;border:1.5px solid var(--line);background:var(--surface);border-radius:18px;padding:13px 8px 11px;text-align:center;cursor:pointer;transition:border-color .15s,background .15s;position:relative}
.cgw .m.on{border-color:var(--violet);background:var(--violet-soft)}
.cgw .m .mi{width:40px;height:40px;border-radius:13px;margin:0 auto 8px;display:flex;align-items:center;justify-content:center;background:var(--soft)}
.cgw .m.on .mi{background:#fff}
.cgw .m .mi svg{width:20px;height:20px;stroke:var(--violet)}
.cgw .m b{font-size:12.5px;font-family:var(--sora);display:block;line-height:1.2}
.cgw .m span{font-size:10px;color:var(--muted);font-weight:600;display:block;margin-top:3px}
.cgw .m .badge-i{position:absolute;top:8px;inset-inline-end:8px;font-size:8.5px;font-weight:800;padding:2px 6px;border-radius:10px;background:rgba(255,45,122,.14);color:var(--rose)}

.cgw .panel{background:var(--surface);border:1px solid var(--line);border-radius:22px;padding:18px;margin-top:13px;box-shadow:var(--sh-s)}
.cgw .plab{font-weight:700;font-size:13.5px;margin-bottom:11px}
.cgw .plab-sora{font-family:var(--sora);font-size:14px}

/* montants */
.cgw .chips{display:grid;grid-template-columns:repeat(3,1fr);gap:9px;margin-bottom:10px}
.cgw .chip{border:1.5px solid var(--line);background:var(--surface);border-radius:14px;padding:12px 6px;text-align:center;font-family:var(--sora);font-weight:700;font-size:14px;cursor:pointer;transition:.15s;color:var(--ink)}
.cgw .chip.on{border-color:var(--violet);background:var(--violet-soft);color:var(--violet)}
.cgw .inp{width:100%;border:1.5px solid var(--line);background:var(--soft);border-radius:14px;padding:14px;font-family:inherit;font-size:15px;font-weight:600;color:var(--ink);outline:none}
.cgw .inp::placeholder{color:var(--muted);font-weight:500}
.cgw .btn{width:100%;height:54px;border:0;border-radius:16px;background:linear-gradient(135deg,var(--violet-l),var(--violet));color:#fff;font-family:var(--sora);font-weight:700;font-size:15px;display:flex;align-items:center;justify-content:center;gap:10px;cursor:pointer;box-shadow:0 14px 28px -12px var(--violet-glow);margin-top:14px}
.cgw .btn:disabled{opacity:.5;cursor:default}
.cgw .btn svg{width:19px;height:19px;stroke:#fff}
.cgw .btn.green{background:var(--go);box-shadow:0 14px 28px -12px rgba(22,179,100,.5)}
.cgw .note{display:flex;gap:8px;align-items:flex-start;font-size:11.5px;color:var(--muted);line-height:1.45;margin-top:12px}
.cgw .note svg{width:14px;height:14px;stroke:var(--muted);flex:none;margin-top:1px}
.cgw .note.go{color:var(--go)}.cgw .note.go svg{stroke:var(--go)}

/* CCP étapes */
.cgw .steps{display:flex;flex-direction:column;gap:0;margin-bottom:14px}
.cgw .st{display:flex;gap:11px}
.cgw .st .l{display:flex;flex-direction:column;align-items:center}
.cgw .st .n{width:24px;height:24px;border-radius:50%;background:var(--violet-soft);color:var(--violet);font-weight:800;font-size:12px;display:flex;align-items:center;justify-content:center;flex:none;font-family:var(--sora)}
.cgw .st .bar{width:2px;flex:1;background:var(--line);min-height:14px}
.cgw .st .tx{font-size:12.5px;font-weight:600;padding-bottom:13px;color:var(--ink)}
.cgw .ccpbox{background:var(--soft);border:1.5px dashed var(--violet);border-radius:14px;padding:13px;margin-bottom:13px;display:flex;align-items:center;gap:12px}
.cgw .ccpbox .cc{flex:1}
.cgw .ccpbox .ck{font-size:10.5px;color:var(--muted);font-weight:700;text-transform:uppercase;letter-spacing:.4px}
.cgw .ccpbox .cv{font-family:var(--sora);font-weight:800;font-size:17px;color:var(--violet);letter-spacing:.5px;margin-top:2px}
.cgw .ccpbox .cs{font-size:11px;color:var(--muted);margin-top:2px}
.cgw .copy{width:40px;height:40px;border-radius:12px;background:var(--surface);border:1px solid var(--line);display:flex;align-items:center;justify-content:center;cursor:pointer;flex:none}.cgw .copy svg{width:17px;height:17px;stroke:var(--violet)}
.cgw .drop{border:1.5px dashed var(--line);border-radius:14px;padding:20px;text-align:center;cursor:pointer;margin-top:11px;transition:.15s}
.cgw .drop:active{border-color:var(--violet);background:var(--violet-soft)}
.cgw .drop.done{border-style:solid;border-color:var(--go);background:var(--go-soft)}
.cgw .drop .di{width:40px;height:40px;border-radius:12px;background:var(--violet-soft);display:flex;align-items:center;justify-content:center;margin:0 auto 8px}.cgw .drop .di svg{width:20px;height:20px;stroke:var(--violet)}
.cgw .drop.done .di{background:#fff}.cgw .drop.done .di svg{stroke:var(--go)}
.cgw .drop b{font-size:13px;display:block}.cgw .drop span{font-size:11px;color:var(--muted);word-break:break-word}

/* agents espèces */
.cgw .cash{margin-top:2px}
.cgw .findrow{display:flex;gap:9px;margin-bottom:11px}
.cgw .loc{display:flex;align-items:center;gap:8px;border:1.5px solid var(--line);border-radius:14px;padding:0 14px;height:46px;font-weight:700;font-size:13.5px;flex:1;cursor:pointer;background:var(--surface);color:var(--ink);min-width:0}
.cgw .loc svg{width:16px;height:16px;stroke:var(--violet);flex:none}.cgw .loc .loc-lbl{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.cgw .loc .mag{margin-inline-start:auto}.cgw .loc .mag svg{stroke:var(--muted)}
.cgw .vl{display:flex;background:var(--soft);border-radius:14px;padding:4px}
.cgw .vl button{border:0;background:transparent;font-family:inherit;font-weight:700;font-size:12.5px;color:var(--muted);padding:8px 13px;border-radius:11px;cursor:pointer;display:flex;align-items:center;gap:6px}.cgw .vl button svg{width:14px;height:14px;stroke:currentColor}
.cgw .vl button.on{background:var(--violet);color:#fff}
.cgw .citybox{display:flex;gap:8px;margin-bottom:11px}
.cgw .citybtn{border:0;border-radius:14px;background:var(--violet);color:#fff;font-family:var(--sora);font-weight:700;font-size:13px;padding:0 18px;cursor:pointer;display:flex;align-items:center;justify-content:center;min-width:64px}.cgw .citybtn:disabled{opacity:.5}.cgw .citybtn svg{width:18px;height:18px;stroke:#fff}
.cgw .useloc{display:flex;align-items:center;gap:8px;color:var(--violet);font-weight:700;font-size:13px;cursor:pointer;margin-bottom:12px}.cgw .useloc svg{width:15px;height:15px;stroke:var(--violet)}
/* Fiche agent — repliée par défaut, dense et à plat (aucune ombre). */
.cgw .agent{border:1px solid var(--line);border-radius:14px;margin-bottom:8px;background:var(--surface);overflow:hidden}
.cgw .agent.open{border-color:var(--violet)}
.cgw .aghead{display:flex;align-items:center;gap:11px;width:100%;padding:10px 12px;background:none;border:0;text-align:start;cursor:pointer;font-family:inherit;color:inherit}
.cgw .agent .ai{width:38px;height:38px;border-radius:11px;background:var(--violet-soft);display:flex;align-items:center;justify-content:center;flex:none}.cgw .agent .ai svg{width:19px;height:19px;stroke:var(--violet)}
.cgw .agent .am{flex:1;min-width:0}
.cgw .agent .am b{font-family:var(--sora);font-weight:700;font-size:13.5px;display:flex;align-items:center;gap:5px;min-width:0}
.cgw .agent .am b>i.agbadge{font-style:normal;font-size:10px;font-weight:800;color:#fff;background:var(--go,#16b364);width:14px;height:14px;border-radius:50%;display:inline-flex;align-items:center;justify-content:center;flex:none}
.cgw .agent .agmeta{display:block;font-size:11.5px;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.cgw .agent .agmeta>i{font-style:normal;font-weight:700;margin-inline-start:6px}
.cgw .agent .agmeta>i.agopen{color:var(--go,#16b364)}
.cgw .agent .agmeta>i.agclosed{color:var(--muted)}
.cgw .agent .dist{font-size:11px;font-weight:800;color:var(--violet);background:var(--violet-soft);padding:3px 8px;border-radius:20px;flex:none}
/* Détail déplié : informations complètes, une ligne par donnée. */
.cgw .agbody{padding:0 12px 11px;border-top:1px solid var(--line)}
.cgw .agrow{display:flex;align-items:baseline;justify-content:space-between;gap:12px;padding:7px 0;font-size:12px;border-bottom:1px solid var(--line)}
.cgw .agrow:last-of-type{border-bottom:0}
.cgw .agrow>span{color:var(--muted);flex:none}
.cgw .agrow>b{font-weight:700;text-align:end;min-width:0;overflow-wrap:anywhere}
.cgw .agactions{display:flex;gap:8px;margin-top:8px}
.cgw .agactions .miniroute{flex:1;margin-top:0;text-decoration:none}
.cgw .agnophone{flex:1;font-size:11.5px;color:var(--muted);display:flex;align-items:center}
/* Filtres — pilules compactes, sans relief. */
.cgw .agfilters{display:flex;align-items:center;gap:6px;margin:10px 0 8px;flex-wrap:wrap}
.cgw .agfilters button{border:1px solid var(--line);background:var(--surface);color:var(--muted);border-radius:20px;padding:5px 11px;font-size:12px;font-weight:700;cursor:pointer;font-family:inherit}
.cgw .agfilters button.on{background:var(--violet);border-color:var(--violet);color:#fff}
.cgw .agcount{margin-inline-start:auto;font-size:11px;font-weight:700;color:var(--muted)}
.cgw .miniroute{width:100%;height:42px;border:0;border-radius:12px;background:var(--violet);color:#fff;font-weight:700;font-size:13px;display:flex;align-items:center;justify-content:center;gap:8px;cursor:pointer;margin-top:7px;font-family:inherit}.cgw .miniroute svg{width:15px;height:15px;stroke:#fff}
.cgw .empty{text-align:center;padding:22px 10px}.cgw .empty .ei{width:48px;height:48px;border-radius:50%;background:var(--soft);display:flex;align-items:center;justify-content:center;margin:0 auto 10px}.cgw .empty .ei svg{width:24px;height:24px;stroke:var(--muted)}
.cgw .empty b{font-size:14px;font-family:var(--sora);display:block}.cgw .empty span{font-size:12px;color:var(--muted)}

/* opérations */
.cgw .op{display:flex;align-items:center;gap:12px;padding:11px 0;border-bottom:1px solid var(--line)}.cgw .op:last-child{border-bottom:0}
.cgw .op .oi{width:38px;height:38px;border-radius:12px;display:flex;align-items:center;justify-content:center;flex:none}.cgw .op .oi svg{width:18px;height:18px}
.cgw .op .oi.cr{background:var(--go-soft)}.cgw .op .oi.cr svg{stroke:var(--go)}
.cgw .op .oi.db{background:rgba(229,72,77,.1)}.cgw .op .oi.db svg{stroke:var(--red)}
.cgw .op .om{flex:1}.cgw .op .om b{font-size:13.5px;display:block}.cgw .op .om span{font-size:11.5px;color:var(--muted)}
.cgw .op .ov{font-family:var(--sora);font-weight:800;font-size:14px}.cgw .op .ov.cr{color:var(--go)}.cgw .op .ov.db{color:var(--red)}

/* états utilitaires */
.cgw .cgw-load{display:flex;align-items:center;justify-content:center;padding:40px 0}
.cgw .cgw-load-ic svg{width:26px;height:26px;stroke:var(--violet)}
.cgw .cgw-mini-load{display:flex;align-items:center;gap:8px;color:var(--muted);font-size:12.5px;font-weight:600;padding:14px 2px}
.cgw .cgw-ret{display:flex;align-items:center;gap:8px;margin-top:12px;padding:10px 13px;border-radius:13px;font-size:12px;font-weight:700;background:var(--soft);color:var(--muted)}
.cgw .cgw-ret svg{width:16px;height:16px;flex:none;stroke:currentColor}
.cgw .cgw-ret.ok{background:var(--go-soft);color:var(--go)}
.cgw .cgw-ret.ko{background:rgba(229,72,77,.1);color:var(--red)}
.cgw .cgw-ret-ic svg{stroke:var(--muted)}
.cgw .cgw-err{margin-top:10px;font-size:12px;font-weight:600;color:var(--red);text-align:center}
.cgw .cgw-ok{margin-top:10px;font-size:12px;font-weight:600;color:var(--go);text-align:center}
.cgw .cgw-hint{color:var(--muted);font-size:11.5px;text-align:center;margin-top:8px}
.cgw .cgw-support{display:flex;align-items:center;justify-content:center;gap:7px;width:100%;margin-top:18px;padding:11px 12px;border:1px solid var(--line,#ECEEF4);border-radius:13px;background:transparent;color:var(--muted);font-weight:600;font-size:12.5px;cursor:pointer;font-family:inherit}
.cgw .cgw-support svg{width:15px;height:15px;stroke:var(--muted);flex:none}

/* feuille sélecteur GPS */
.cgw-sheet{position:fixed;inset:0;z-index:120;display:flex;align-items:flex-end;justify-content:center;background:rgba(0,0,0,.5);padding:16px}
.cgw-sheet-card{background:var(--surface,#fff);width:100%;max-width:380px;border-radius:18px;padding:16px;color:var(--ink)}
.cgw-sheet-t{font-family:var(--font-display),'Sora',sans-serif;font-weight:800;font-size:16px;margin:0 0 4px}
.cgw-sheet-s{color:#878CA0;font-size:12px;margin:0 0 12px}
.cgw-sheet-row{display:flex;align-items:center;gap:12px;width:100%;border:1px solid #ECEEF4;border-radius:12px;padding:11px 12px;background:transparent;font-weight:700;font-size:14px;cursor:pointer;margin-bottom:8px;text-align:start;color:inherit;font-family:inherit}
.cgw-sheet-cancel{width:100%;text-align:center;border:0;background:transparent;color:#878CA0;font-weight:600;font-size:14px;cursor:pointer;margin-top:4px;font-family:inherit}

.cgw .cgw-spin,.cgw-spin{animation:cgw-rot .8s linear infinite}
@keyframes cgw-rot{to{transform:rotate(360deg)}}
`;
