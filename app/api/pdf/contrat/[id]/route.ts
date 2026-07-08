import { NextResponse, type NextRequest } from "next/server";
import { PDFDocument, PDFPage, StandardFonts, type PDFFont } from "pdf-lib";
import { createClient } from "@/lib/supabase/server";
import { adminCan } from "@/lib/auth/admin";
import { APP_CONFIG } from "@/lib/config/app-config";
import { LEGAL } from "@/lib/config/legal";
import { PDF_INK, type Fonts, grp, makeText, safe } from "@/lib/pdf/pdf-kit";
import type { MerchantContractRow } from "@/lib/types/merchant-contract";

export const dynamic = "force-dynamic";

/**
 * CONTRAT DE PARTENARIAT COMMERÇANT en VRAI PDF (pdf-lib serveur).
 * Acte sous seing privé (art. 327 du code civil algérien) : signatures
 * manuscrites précédées de « lu et approuvé », cachet du commerçant, deux
 * exemplaires originaux. Contenu figé depuis merchant_contracts (party/terms).
 * Auth : admin du domaine « commercants ».
 */

const { VIOLET, INK, MUTED, LINE, WHITE } = PDF_INK;

const W = 595.28;
const H = 841.89; // A4 portrait
const M = 52;
const BODY = 9.3;
const LEAD = 12.6;

type Block =
  | { kind: "article"; title: string }
  | { kind: "p"; text: string }
  | { kind: "li"; text: string }
  | { kind: "gap" };

function wrap(s: string, f: PDFFont, size: number, maxW: number): string[] {
  const words = s.split(" ");
  const lines: string[] = [];
  let line = "";
  for (const w of words) {
    const probe = line ? `${line} ${w}` : w;
    if (f.widthOfTextAtSize(probe, size) > maxW && line) {
      lines.push(line);
      line = w;
    } else {
      line = probe;
    }
  }
  if (line) lines.push(line);
  return lines;
}

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  if (!(await adminCan("commercants"))) {
    return NextResponse.json({ error: "Accès refusé" }, { status: 403 });
  }
  const { id } = await ctx.params;
  const supabase = await createClient();
  const { data } = await supabase
    .from("merchant_contracts" as never)
    .select("*")
    .eq("id", id)
    .maybeSingle();
  const c = data as unknown as MerchantContractRow | null;
  if (!c) {
    return NextResponse.json({ error: "Contrat introuvable" }, { status: 404 });
  }

  const p = c.party;
  const t = c.terms;
  const equip = t.equipment;
  const dayFr = (iso: string | null | undefined) =>
    iso ? String(iso).slice(0, 10).split("-").reverse().join("/") : "—";

  // ── Texte du contrat ────────────────────────────────────────────────────
  const platformId = `${LEGAL.platform}, plateforme éditée et exploitée par M. ${LEGAL.ownerFullName}, ${LEGAL.status.toLowerCase()} régi par la ${LEGAL.statusLaw}, immatriculé au ${LEGAL.registrationLabel} sous le n° ${LEGAL.registrationNumber}, dont le siège est situé à ${LEGAL.address} — e-mail : ${APP_CONFIG.contact.supportEmail} (ci-après « la Plateforme »)`;
  const merchantId = `${safe(p.merchant_name)}, ${safe(p.legal_form)}, immatriculé(e) sous le n° ${safe(p.rc_number)}${p.nif ? `, NIF ${safe(p.nif)}` : ""}, dont l'établissement est situé à ${safe(p.address)}${p.commune ? `, ${safe(p.commune)}` : ""}${p.wilaya ? ` (wilaya ${safe(p.wilaya)})` : ""}, représenté(e) par ${safe(p.representative)}${p.phone ? ` — tél. : ${safe(p.phone)}` : ""}${p.email ? ` — e-mail : ${safe(p.email)}` : ""} (ci-après « le Commerçant »)`;

  const duration =
    t.duration_type === "determinee"
      ? `Le présent contrat est conclu pour une durée déterminée de ${t.duration_months ?? 12} mois à compter du ${dayFr(t.effective_date)}, renouvelable par tacite reconduction pour des périodes identiques, sauf dénonciation par l'une des parties avec un préavis de ${t.notice_days} jours avant l'échéance.`
      : `Le présent contrat est conclu pour une durée indéterminée à compter du ${dayFr(t.effective_date)}. Chaque partie peut y mettre fin à tout moment moyennant un préavis écrit de ${t.notice_days} jours, sans préjudice de l'apurement des sommes dues.`;

  const blocks: Block[] = [
    { kind: "p", text: "Entre les soussignés :" },
    { kind: "li", text: platformId },
    { kind: "li", text: merchantId },
    {
      kind: "p",
      text: "Il a été préalablement exposé que la Plateforme exploite un service d'intermédiation en ligne au sens de la loi n° 18-05 du 10 mai 2018 relative au commerce électronique, mettant en relation des clients et des commerçants indépendants, et que le Commerçant, régulièrement immatriculé conformément à la loi n° 04-08 du 14 août 2004 relative aux conditions d'exercice des activités commerciales, souhaite référencer son établissement sur la Plateforme. Ceci exposé, il a été convenu ce qui suit :",
    },

    { kind: "article", title: "Article 1 — Objet" },
    {
      kind: "p",
      text: "Le présent contrat définit les conditions dans lesquelles la Plateforme référence le Commerçant, présente son catalogue aux clients, transmet les commandes, encaisse le cas échéant les paiements pour le compte du Commerçant et organise, selon les options actives, la livraison des commandes. La Plateforme agit en qualité d'intermédiaire technique : elle n'achète ni ne revend les produits du Commerçant ; le contrat de vente se forme directement entre le Commerçant et le client.",
    },

    { kind: "article", title: "Article 2 — Documents contractuels" },
    {
      kind: "p",
      text: "Le présent contrat, ses annexes et les conditions générales d'utilisation de la Plateforme (consultables à l'adresse coligo.app/cgu) forment un ensemble contractuel. En cas de contradiction, le présent contrat prévaut sur les conditions générales.",
    },

    { kind: "article", title: "Article 3 — Durée, entrée en vigueur" },
    { kind: "p", text: duration },

    { kind: "article", title: "Article 4 — Obligations de la Plateforme" },
    {
      kind: "li",
      text: "Référencer l'établissement et le catalogue du Commerçant et mettre à sa disposition un espace professionnel (gestion du catalogue, des commandes, des relevés et des versements) ;",
    },
    {
      kind: "li",
      text: "Transmettre les commandes en temps réel et, pour les paiements en ligne, encaisser les sommes pour le compte du Commerçant via des prestataires de paiement agréés en Algérie ;",
    },
    {
      kind: "li",
      text: `Tenir un relevé fidèle et horodaté des opérations et verser au Commerçant les sommes lui revenant dans un délai de ${t.payout_delay_days} jours ouvrés suivant sa demande de versement, selon la procédure de l'espace professionnel ;`,
    },
    {
      kind: "li",
      text: "Assurer un support opérationnel et traiter les réclamations ; protéger les données conformément à la loi n° 18-07 du 10 juin 2018.",
    },

    { kind: "article", title: "Article 5 — Obligations du Commerçant" },
    {
      kind: "li",
      text: "Maintenir une immatriculation valide et exercer conformément à la réglementation, notamment la loi n° 09-03 du 25 février 2009 relative à la protection du consommateur et à la répression des fraudes (modifiée et complétée) et ses textes d'application en matière d'hygiène et de conformité ;",
    },
    {
      kind: "li",
      text: "Garantir l'exactitude de son catalogue : désignations, photographies fidèles, disponibilité et prix affichés en dinars algériens toutes taxes comprises (loi n° 04-02 du 23 juin 2004 relative aux pratiques commerciales) ; les prix pratiqués sur la Plateforme ne peuvent excéder ceux pratiqués en boutique ;",
    },
    {
      kind: "li",
      text: "Préparer les commandes dans les délais annoncés, remettre les commandes aux seuls porteurs du code de retrait ou aux livreurs identifiés, et assumer la responsabilité de la qualité et de la conformité des produits ;",
    },
    {
      kind: "li",
      text: "S'abstenir de tout détournement de clientèle acquise via la Plateforme (démarchage hors plateforme à partir des données de commande) et de toute atteinte à l'image de la Plateforme.",
    },

    { kind: "article", title: "Article 6 — Conditions financières" },
    {
      kind: "p",
      text: `En rémunération de ses services, la Plateforme perçoit une commission calculée sur le montant des produits de chaque commande : ${t.commission_cash_pct} % pour les ventes payées en espèces et ${t.commission_online_pct} % pour les ventes payées en ligne, taux figés commande par commande au moment de sa validation. Les frais de service facturés aux clients sont affichés avant validation. Toute évolution des taux est notifiée au Commerçant au moins quinze (15) jours à l'avance ; la poursuite de l'activité après l'entrée en vigueur vaut acceptation. Un récapitulatif mensuel et des factures sont émis dans l'espace professionnel.`,
    },

    {
      kind: "article",
      title: "Article 7 — Encaissements, dettes et compensation",
    },
    {
      kind: "li",
      text: `Ventes en ligne : la Plateforme encaisse pour le compte du Commerçant et lui reverse le montant, déduction faite de la commission, selon l'article 4 ;`,
    },
    {
      kind: "li",
      text: `Ventes en espèces : le Commerçant encaisse directement ; la commission et, le cas échéant, les frais de service perçus pour le compte de la Plateforme constituent une dette exigible du Commerçant, à reverser dans un délai maximal de ${t.cash_settlement_days} jours suivant l'arrêté figurant dans l'espace professionnel ;`,
    },
    {
      kind: "li",
      text: "Compensation : conformément aux articles 297 et suivants du code civil, les créances réciproques, certaines, liquides et exigibles se compensent de plein droit ; la Plateforme peut imputer les commissions dues sur les versements à effectuer ;",
    },
    {
      kind: "li",
      text: `Plafond d'endettement : lorsque la dette nette du Commerçant atteint ${grp(t.debt_cap_da)} DA, la Plateforme peut suspendre la prise de nouvelles commandes jusqu'à régularisation ;`,
    },
    {
      kind: "li",
      text: "Preuve : les registres électroniques horodatés et infalsifiables de la Plateforme font foi entre les parties (convention de preuve, admissible au sens de la loi n° 15-04 du 1er février 2015 et de l'article 323 bis du code civil), sauf preuve contraire.",
    },

    { kind: "article", title: "Article 8 — Retard de paiement" },
    {
      kind: "p",
      text: "Toute somme non reversée à l'échéance porte, après mise en demeure restée sans effet huit (8) jours, intérêts de retard au taux légal en vigueur, sans préjudice de la suspension du compte, des frais de recouvrement et de la résiliation prévue à l'article 10.",
    },
  ];

  // Article matériel (optionnel) — inséré avant suspension pour que les
  // clauses de retrait puissent y renvoyer.
  if (equip.provided) {
    blocks.push(
      { kind: "article", title: "Article 9 — Matériel remis au Commerçant" },
      {
        kind: "p",
        text: equip.return_required
          ? "La Plateforme met à la disposition du Commerçant le matériel décrit en Annexe 1, qui demeure la propriété exclusive de la Plateforme. Le Commerçant en assure la garde et l'usage en bon père de famille, l'utilise exclusivement pour les besoins du service et le restitue en bon état (usure normale admise) à la première demande de la Plateforme et, au plus tard, à la fin du contrat. En cas de perte, de vol, de dégradation ou de non-restitution sous huit (8) jours après demande, la valeur indiquée en Annexe 1 est facturée au Commerçant et devient une dette exigible au sens de l'article 7."
          : "La Plateforme remet au Commerçant le matériel décrit en Annexe 1, aux frais qui y sont indiqués. Sauf stipulation contraire en Annexe, ce matériel est cédé au Commerçant à la remise : il en devient propriétaire et en assume la garde, l'entretien et la responsabilité, sans obligation de restitution en fin de contrat.",
      },
      {
        kind: "p",
        text: "L'état du matériel et ses identifiants (numéros de série / IMEI) sont constatés contradictoirement à la remise et consignés en Annexe 1.",
      }
    );
  }

  const artOffset = equip.provided ? 1 : 0;
  const artNo = (n: number) => `Article ${n + (n >= 9 ? artOffset : 0)}`;

  blocks.push(
    {
      kind: "article",
      title: `${artNo(9)} — Suspension du contrat et du compte`,
    },
    {
      kind: "p",
      text: `La Plateforme peut suspendre temporairement le compte du Commerçant, après notification motivée (immédiate en cas d'urgence), dans les cas suivants : dette excédant le plafond de l'article 7 ; manquements répétés à la qualité ou aux délais ; suspicion sérieuse de fraude ; produits interdits ou non conformes ; comportement portant atteinte aux utilisateurs ou à l'image de la Plateforme ; réquisition d'une autorité. La suspension ne suspend pas l'exigibilité des sommes dues.${equip.provided && equip.return_required ? " Pendant la suspension, la Plateforme peut exiger la restitution immédiate du matériel mis à disposition (Annexe 1)." : ""}`,
    },
    { kind: "article", title: `${artNo(10)} — Résiliation` },
    {
      kind: "p",
      text: `Chaque partie peut résilier le contrat moyennant le préavis de l'article 3. En cas de manquement grave non réparé dans les quinze (15) jours d'une mise en demeure écrite, la résiliation peut intervenir de plein droit, sans préjudice de dommages et intérêts. La résiliation emporte : déréférencement de l'établissement ; apurement des comptes et paiement de toute somme due de part et d'autre${equip.provided && equip.return_required ? " ; restitution du matériel mis à disposition dans les huit (8) jours, à défaut de quoi sa valeur (Annexe 1) est facturée" : ""}. Les articles relatifs aux paiements, à la preuve, à la confidentialité et aux données survivent à la fin du contrat.`,
    },
    { kind: "article", title: `${artNo(11)} — Responsabilité et assurance` },
    {
      kind: "p",
      text: "Le Commerçant est seul responsable de ses produits et de leur conformité, ainsi que des dommages causés par son fait ; il déclare disposer des assurances requises par son activité. La responsabilité de la Plateforme, limitée à son rôle d'intermédiaire technique, ne saurait être engagée pour les cas de force majeure (article 127 du code civil), l'interruption des réseaux ou les manquements imputables au Commerçant, aux livreurs indépendants ou aux clients.",
    },
    { kind: "article", title: `${artNo(12)} — Indépendance des parties` },
    {
      kind: "p",
      text: "Les parties sont et demeurent des professionnels indépendants. Le présent contrat ne crée ni société, ni mandat général, ni lien de subordination ; le personnel du Commerçant reste sous sa seule autorité et responsabilité (déclarations sociales et fiscales comprises).",
    },
    {
      kind: "article",
      title: `${artNo(13)} — Propriété intellectuelle et image`,
    },
    {
      kind: "p",
      text: "Chaque partie reste titulaire de ses signes distinctifs (ordonnances n° 03-05 et n° 03-06 du 19 juillet 2003). Le Commerçant autorise la Plateforme à reproduire son nom, son logo et les visuels de ses produits aux seules fins d'exploitation et de promotion du service, pendant la durée du contrat. Toute autre utilisation requiert un accord écrit.",
    },
    {
      kind: "article",
      title: `${artNo(14)} — Données personnelles et confidentialité`,
    },
    {
      kind: "p",
      text: "Chaque partie traite les données personnelles conformément à la loi n° 18-07 du 10 juin 2018. Le Commerçant n'utilise les données des clients transmises par la Plateforme que pour l'exécution des commandes, à l'exclusion de toute prospection. Les conditions commerciales du présent contrat sont confidentielles.",
    },
    { kind: "article", title: `${artNo(15)} — Notifications` },
    {
      kind: "p",
      text: "Les notifications sont valablement effectuées par écrit aux adresses figurant en tête des présentes, par voie électronique aux adresses e-mail déclarées ou via l'espace professionnel de la Plateforme, la date d'envoi faisant foi.",
    },
    {
      kind: "article",
      title: `${artNo(16)} — Droit applicable et règlement des litiges`,
    },
    {
      kind: "p",
      text: "Le présent contrat est régi par le droit algérien. Les parties s'efforcent de résoudre amiablement tout différend dans un délai de trente (30) jours à compter de sa notification. À défaut, le litige relève des juridictions algériennes territorialement compétentes conformément au code de procédure civile et administrative.",
    },
    { kind: "article", title: `${artNo(17)} — Dispositions finales` },
    {
      kind: "p",
      text: "Si une stipulation est déclarée nulle, les autres conservent leur effet. Toute modification requiert un avenant écrit signé des deux parties. Le présent contrat constitue un acte sous seing privé (article 327 du code civil) établi en deux (2) exemplaires originaux, un pour chaque partie.",
    }
  );

  // ── Rendu ───────────────────────────────────────────────────────────────
  const doc = await PDFDocument.create();
  const fonts: Fonts = {
    font: await doc.embedFont(StandardFonts.Helvetica),
    bold: await doc.embedFont(StandardFonts.HelveticaBold),
  };

  let page!: PDFPage;
  let text!: ReturnType<typeof makeText>;
  let y = 0;
  let pageNo = 0;

  const footer = () => {
    text(`${c.contract_number} — page ${pageNo}`, W - M, M - 24, 7.5, {
      right: true,
      color: MUTED,
    });
    text(
      `${LEGAL.platform} · ${LEGAL.registrationLabel} n° ${LEGAL.registrationNumber}`,
      M,
      M - 24,
      7.5,
      { color: MUTED }
    );
  };

  const newPage = () => {
    page = doc.addPage([W, H]);
    text = makeText(page, fonts);
    pageNo += 1;
    y = H - M;
    if (pageNo === 1) {
      page.drawRectangle({
        x: 0,
        y: H - 88,
        width: W,
        height: 88,
        color: VIOLET,
      });
      text("COLIGO", M, H - 40, 20, { bold: true, color: WHITE });
      text("CONTRAT DE PARTENARIAT COMMERÇANT", M, H - 60, 11.5, {
        bold: true,
        color: WHITE,
      });
      text(`N° ${c.contract_number}`, W - M, H - 40, 11, {
        right: true,
        bold: true,
        color: WHITE,
      });
      text(`Émis le ${dayFr(c.created_at)}`, W - M, H - 58, 8.5, {
        right: true,
        color: WHITE,
      });
      y = H - 112;
    }
    footer();
  };

  const need = (h: number) => {
    if (y - h < M) newPage();
  };

  const para = (
    s: string,
    opts: { indent?: number; bullet?: boolean } = {}
  ) => {
    const indent = opts.indent ?? 0;
    const bx = M + indent;
    const maxW = W - M - bx - (opts.bullet ? 10 : 0);
    const lines = wrap(s, fonts.font, BODY, maxW);
    for (let i = 0; i < lines.length; i++) {
      need(LEAD);
      if (opts.bullet && i === 0) {
        text("–", bx, y, BODY, { color: INK });
      }
      text(lines[i], bx + (opts.bullet ? 10 : 0), y, BODY, { color: INK });
      y -= LEAD;
    }
  };

  newPage();

  for (const b of blocks) {
    if (b.kind === "article") {
      need(LEAD * 3);
      y -= 6;
      text(b.title, M, y, 10.2, { bold: true, color: VIOLET });
      y -= LEAD + 2;
    } else if (b.kind === "p") {
      para(b.text);
      y -= 4;
    } else if (b.kind === "li") {
      para(b.text, { indent: 8, bullet: true });
      y -= 2;
    } else {
      y -= LEAD;
    }
  }

  // ── Annexe 1 : matériel ─────────────────────────────────────────────────
  if (equip.provided) {
    need(LEAD * 6);
    y -= 10;
    text("ANNEXE 1 — Inventaire du matériel remis", M, y, 10.2, {
      bold: true,
      color: VIOLET,
    });
    y -= LEAD + 4;
    para(
      equip.return_required
        ? "Matériel mis à disposition (propriété de la Plateforme — restitution obligatoire, article " +
            String(9) +
            ") :"
        : "Matériel remis au Commerçant (cédé à la remise — aucune restitution exigée) :"
    );
    y -= 2;
    const cols = [
      { label: "Désignation", w: 150 },
      { label: "Qté", w: 30 },
      { label: "Valeur (DA)", w: 70 },
      { label: "État", w: 60 },
      { label: "N° série / IMEI", w: 105 },
      { label: "Notes", w: 76 },
    ];
    const colX: number[] = [];
    let acc = M;
    for (const col of cols) {
      colX.push(acc);
      acc += col.w;
    }
    need(LEAD * 2);
    for (let i = 0; i < cols.length; i++) {
      text(cols[i].label, colX[i], y, 8, { bold: true, color: MUTED });
    }
    y -= 5;
    page.drawLine({
      start: { x: M, y },
      end: { x: W - M, y },
      thickness: 0.8,
      color: LINE,
    });
    y -= LEAD;
    let totalDa = 0;
    for (const it of equip.items) {
      need(LEAD);
      totalDa += (it.unit_cost_da || 0) * (it.qty || 1);
      const cells = [
        safe(it.label),
        String(it.qty || 1),
        grp(it.unit_cost_da || 0),
        safe(it.condition),
        safe(it.serial),
        safe(it.notes),
      ];
      for (let i = 0; i < cells.length; i++) {
        const maxW = cols[i].w - 6;
        let s = cells[i];
        while (s.length > 1 && fonts.font.widthOfTextAtSize(s, 8) > maxW) {
          s = s.slice(0, -1);
        }
        text(s, colX[i], y, 8, { color: INK });
      }
      y -= LEAD;
    }
    page.drawLine({
      start: { x: M, y: y + 8 },
      end: { x: W - M, y: y + 8 },
      thickness: 0.8,
      color: LINE,
    });
    need(LEAD);
    text(`Valeur totale : ${grp(totalDa)} DA`, W - M, y - 2, 9, {
      right: true,
      bold: true,
    });
    y -= LEAD * 1.5;
    para(
      "État contradictoirement constaté à la remise. Signatures de l'annexe : les mêmes que celles du contrat."
    );
  }

  // ── Bloc signatures ─────────────────────────────────────────────────────
  if (y < M + 170) newPage();
  y -= 14;
  text(
    `Fait à ${safe(t.sign_place)}, le ${".".repeat(24)}, en deux (2) exemplaires originaux.`,
    M,
    y,
    BODY,
    { color: INK }
  );
  y -= LEAD * 1.6;
  para(
    "Signature du Commerçant précédée de la mention manuscrite « lu et approuvé », accompagnée du cachet commercial. Signature de la Plateforme précédée de la même mention."
  );
  y -= LEAD;

  const colW = (W - 2 * M - 24) / 2;
  const boxH = 108;
  need(boxH + 20);
  const drawSignBox = (x: number, title: string, sub: string[]) => {
    page.drawRectangle({
      x,
      y: y - boxH,
      width: colW,
      height: boxH,
      borderColor: LINE,
      borderWidth: 1,
    });
    text(title, x + 10, y - 16, 9.5, { bold: true });
    let sy = y - 30;
    for (const s of sub) {
      text(s, x + 10, sy, 8, { color: MUTED });
      sy -= 11;
    }
    text("Lu et approuvé — signature :", x + 10, y - boxH + 14, 8, {
      color: MUTED,
    });
  };
  drawSignBox(M, "Pour la Plateforme", [
    safe(`M. ${LEGAL.ownerFullName}`),
    `${LEGAL.platform} — n° ${LEGAL.registrationNumber}`,
  ]);
  drawSignBox(M + colW + 24, "Pour le Commerçant", [
    safe(p.representative),
    safe(p.merchant_name),
    `RC ${safe(p.rc_number)} — cachet obligatoire`,
  ]);
  y -= boxH + 8;

  const bytes = await doc.save();
  return new NextResponse(Buffer.from(bytes), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="contrat-${c.contract_number}.pdf"`,
      "Cache-Control": "no-store",
    },
  });
}
