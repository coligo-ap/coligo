import { NextResponse, type NextRequest } from "next/server";
import { PDFDocument, PDFPage, StandardFonts, type PDFFont } from "pdf-lib";
import { createClient } from "@/lib/supabase/server";
import { APP_CONFIG } from "@/lib/config/app-config";
import { LEGAL } from "@/lib/config/legal";
import { PDF_INK, type Fonts, grp, makeText, safe } from "@/lib/pdf/pdf-kit";
import {
  PARTNER_KIND_META,
  type PartnerContractRow,
} from "@/lib/types/partner-contract";

export const dynamic = "force-dynamic";

/**
 * CONTRAT DE PARTENARIAT LIVREUR / CHAUFFEUR en VRAI PDF (pdf-lib serveur).
 * Prestataire indépendant (aucun lien de subordination), acte sous seing privé
 * (art. 327 du code civil), « lu et approuvé », deux exemplaires originaux.
 * Auth : les RLS de partner_contracts (domaine admin selon le kind) — une
 * ligne introuvable = pas le droit ou inexistante.
 */

const { VIOLET, INK, MUTED, LINE, WHITE } = PDF_INK;

const W = 595.28;
const H = 841.89;
const M = 52;
const BODY = 9.3;
const LEAD = 12.6;

type Block =
  | { kind: "article"; title: string }
  | { kind: "p"; text: string }
  | { kind: "li"; text: string };

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
  const { id } = await ctx.params;
  const supabase = await createClient();
  const { data } = await supabase
    .from("partner_contracts" as never)
    .select("*")
    .eq("id", id)
    .maybeSingle();
  const c = data as unknown as PartnerContractRow | null;
  if (!c) {
    return NextResponse.json(
      { error: "Contrat introuvable ou accès refusé" },
      { status: 404 }
    );
  }

  const isDriver = c.partner_kind === "driver";
  const roleTitle = isDriver ? "LIVREUR" : "CHAUFFEUR";
  const role = PARTNER_KIND_META[c.partner_kind].role; // Livreur/Chauffeur partenaire
  const mission = isDriver
    ? "la livraison de commandes"
    : "le transport de personnes (service Coligo Drive)";
  const unit = isDriver ? "livraison" : "course";

  const p = c.party;
  const t = c.terms;
  const equip = t.equipment;
  const dayFr = (iso: string | null | undefined) =>
    iso ? String(iso).slice(0, 10).split("-").reverse().join("/") : "—";

  const platformBlock = `${LEGAL.platform}, plateforme éditée et exploitée par M. ${LEGAL.ownerFullName}, ${LEGAL.status.toLowerCase()} régi par la ${LEGAL.statusLaw}, immatriculé au ${LEGAL.registrationLabel} sous le n° ${LEGAL.registrationNumber}, dont le siège est situé à ${LEGAL.address} — e-mail : ${APP_CONFIG.contact.supportEmail} (ci-après « la Plateforme »)`;
  const vehicle = [p.vehicle_type, p.vehicle_brand, p.vehicle_model]
    .filter(Boolean)
    .join(" ");
  const partnerBlock = `${safe(p.full_name)}, ${safe(p.work_status).toLowerCase()}${p.registration_number ? `, immatriculé(e) sous le n° ${safe(p.registration_number)}` : ""}, titulaire de la pièce d'identité n° ${safe(p.id_number)} et du permis de conduire n° ${safe(p.license_number)}, demeurant à ${safe(p.address)}${p.wilaya ? ` (wilaya ${safe(p.wilaya)})` : ""}, utilisant le véhicule ${safe(vehicle)} immatriculé ${safe(p.vehicle_plate)}${p.phone ? ` — tél. : ${safe(p.phone)}` : ""}${p.email ? ` — e-mail : ${safe(p.email)}` : ""} (ci-après « le Partenaire »)`;

  const duration =
    t.duration_type === "determinee"
      ? `Le présent contrat est conclu pour une durée déterminée de ${t.duration_months ?? 12} mois à compter du ${dayFr(t.effective_date)}, renouvelable par tacite reconduction pour des périodes identiques, sauf dénonciation par l'une des parties avec un préavis de ${t.notice_days} jours avant l'échéance.`
      : `Le présent contrat est conclu pour une durée indéterminée à compter du ${dayFr(t.effective_date)}. Chaque partie peut y mettre fin à tout moment moyennant un préavis écrit de ${t.notice_days} jours, sans préjudice de l'apurement des sommes dues.`;

  const blocks: Block[] = [
    { kind: "p", text: "Entre les soussignés :" },
    { kind: "li", text: platformBlock },
    { kind: "li", text: partnerBlock },
    {
      kind: "p",
      text: `Il a été préalablement exposé que la Plateforme exploite un service d'intermédiation en ligne au sens de la loi n° 18-05 du 10 mai 2018 relative au commerce électronique, mettant en relation des clients et des prestataires indépendants pour ${mission}, et que le Partenaire souhaite recevoir des propositions de ${unit}s via la Plateforme, en toute indépendance. Ceci exposé, il a été convenu ce qui suit :`,
    },

    { kind: "article", title: "Article 1 — Objet" },
    {
      kind: "p",
      text: `Le présent contrat définit les conditions dans lesquelles la Plateforme met à la disposition du Partenaire une application professionnelle lui transmettant des propositions de ${unit}s émises par les clients${isDriver ? " et les commerçants partenaires" : ""}, et dans lesquelles le Partenaire exécute, sous sa seule responsabilité, les ${unit}s qu'il choisit librement d'accepter. La Plateforme n'est pas un transporteur : elle agit exclusivement comme intermédiaire technique.`,
    },

    { kind: "article", title: "Article 2 — Indépendance du Partenaire" },
    {
      kind: "p",
      text: `Le Partenaire exerce en qualité de prestataire indépendant. Le présent contrat ne crée aucun lien de subordination, aucun contrat de travail, aucune exclusivité ni aucun mandat général : le Partenaire reste libre de ses horaires, de ses connexions, d'accepter ou de refuser chaque ${unit}, et de travailler avec d'autres plateformes ou clients. Il fait son affaire de ses obligations fiscales et sociales ainsi que, le cas échéant, de son immatriculation professionnelle (notamment sous le statut de l'auto-entrepreneur, loi n° 22-23 du 18 décembre 2022).`,
    },

    { kind: "article", title: "Article 3 — Durée, entrée en vigueur" },
    { kind: "p", text: duration },

    { kind: "article", title: "Article 4 — Obligations de la Plateforme" },
    {
      kind: "li",
      text: `Donner accès à l'application professionnelle (réception des ${unit}s, itinéraires, relevés, historique) et transmettre les propositions de ${unit}s de manière loyale, selon la proximité et les règles de répartition affichées ;`,
    },
    {
      kind: "li",
      text: `Tenir un relevé fidèle et horodaté des opérations, et verser au Partenaire les gains lui revenant dans un délai de ${t.payout_delay_days} jours ouvrés suivant sa demande, selon la procédure de l'application ;`,
    },
    {
      kind: "li",
      text: "Assurer un support opérationnel, des dispositifs de sécurité (masquage des numéros de téléphone, signalement) et protéger les données conformément à la loi n° 18-07 du 10 juin 2018.",
    },

    { kind: "article", title: "Article 5 — Obligations du Partenaire" },
    {
      kind: "li",
      text: "Détenir et maintenir en cours de validité : permis de conduire, pièce d'identité, assurance du véhicule couvrant l'usage exercé, documents du véhicule (carte grise, contrôle technique) — et fournir toute mise à jour à première demande ;",
    },
    {
      kind: "li",
      text: `Respecter le code de la route (loi n° 01-14 du 19 août 2001, modifiée, relative à l'organisation, la sécurité et la police de la circulation routière) et se comporter avec courtoisie et professionnalisme envers les clients${isDriver ? " et les commerçants" : ""} ;`,
    },
    ...(isDriver
      ? [
          {
            kind: "li" as const,
            text: "Assurer l'hygiène et l'intégrité des commandes transportées (utilisation d'un contenant adapté, remise au seul destinataire ou via le code de livraison), et signaler sans délai tout incident ;",
          },
        ]
      : [
          {
            kind: "li" as const,
            text: "Détenir les autorisations exigées, le cas échéant, par la réglementation applicable au transport de personnes, maintenir le véhicule déclaré en parfait état de propreté et de sécurité, et n'exécuter les courses qu'avec ce véhicule ;",
          },
        ]),
    {
      kind: "li",
      text: "Utiliser le compte à titre strictement personnel : le prêt, la sous-location ou le partage du compte à un tiers est un manquement grave entraînant blocage immédiat ;",
    },
    {
      kind: "li",
      text: "S'abstenir de tout détournement de clientèle (prestation hors plateforme sollicitée à partir d'une mise en relation Coligo) et de toute atteinte à l'image de la Plateforme.",
    },

    { kind: "article", title: "Article 6 — Rémunération et frais de service" },
    {
      kind: "p",
      text: `Le Partenaire perçoit, pour chaque ${unit} menée à terme, la rémunération affichée dans l'application avant son acceptation. En contrepartie de l'intermédiation, la Plateforme perçoit des frais de service de ${t.fee_pct} % calculés sur le prix de chaque ${unit}, figés au moment de son acceptation. Toute évolution du taux est notifiée au moins quinze (15) jours à l'avance ; la poursuite de l'activité vaut acceptation. Les gains, frais et retenues figurent dans les relevés de l'application.`,
    },

    {
      kind: "article",
      title: "Article 7 — Espèces détenues, dettes et compensation",
    },
    ...(isDriver
      ? [
          {
            kind: "li" as const,
            text: `Lorsque le client règle en espèces, le Partenaire encaisse pour le compte du commerçant et de la Plateforme : il détient ces fonds en qualité de simple dépositaire, dans la limite d'un plafond de ${grp(t.float_cap_da)} DA, et les reverse selon le cycle de règlement (${t.settlement_days} jours au plus) et les relevés générés par la Plateforme ;`,
          },
        ]
      : [
          {
            kind: "li" as const,
            text: `Lorsque le client règle la course en espèces, le Partenaire encaisse directement : les frais de service dus à la Plateforme constituent alors une dette exigible, à régler selon le cycle de règlement (${t.settlement_days} jours au plus) et les relevés de l'application ;`,
          },
        ]),
    {
      kind: "li",
      text: "Compensation : conformément aux articles 297 et suivants du code civil, les créances réciproques, certaines, liquides et exigibles se compensent de plein droit ; la Plateforme peut imputer les sommes dues sur les gains à verser ;",
    },
    {
      kind: "li",
      text: `Plafond de dette : lorsque la dette nette du Partenaire atteint ${grp(t.debt_cap_da)} DA, la Plateforme peut geler le compte (suspension des nouvelles ${unit}s) jusqu'à régularisation ;`,
    },
    {
      kind: "li",
      text: "Preuve : les registres électroniques horodatés et infalsifiables de la Plateforme font foi entre les parties (convention de preuve, loi n° 15-04 du 1er février 2015 et article 323 bis du code civil), sauf preuve contraire.",
    },

    { kind: "article", title: "Article 8 — Retard de paiement" },
    {
      kind: "p",
      text: "Toute somme non reversée à l'échéance porte, après mise en demeure restée sans effet huit (8) jours, intérêts de retard au taux légal en vigueur, sans préjudice du gel du compte, des frais de recouvrement et de la résiliation prévue ci-après.",
    },
  ];

  if (equip.provided) {
    blocks.push(
      { kind: "article", title: "Article 9 — Matériel remis au Partenaire" },
      {
        kind: "p",
        text: equip.return_required
          ? "La Plateforme met à la disposition du Partenaire le matériel décrit en Annexe 1, qui demeure sa propriété exclusive. Le Partenaire en assure la garde, l'utilise exclusivement pour les besoins du service et le restitue en bon état (usure normale admise) à première demande et, au plus tard, à la fin du contrat. En cas de perte, de vol, de dégradation ou de non-restitution sous huit (8) jours après demande, la valeur indiquée en Annexe 1 est facturée au Partenaire et devient une dette exigible au sens de l'article 7."
          : "La Plateforme remet au Partenaire le matériel décrit en Annexe 1, aux frais qui y sont indiqués. Sauf stipulation contraire en Annexe, ce matériel est cédé au Partenaire à la remise : il en devient propriétaire et en assume la garde, l'entretien et la responsabilité, sans obligation de restitution en fin de contrat.",
      },
      {
        kind: "p",
        text: "L'état du matériel et ses identifiants (numéros de série / IMEI) sont constatés contradictoirement à la remise et consignés en Annexe 1.",
      }
    );
  }

  const off = equip.provided ? 1 : 0;
  const artNo = (n: number) => `Article ${n + off}`;

  blocks.push(
    { kind: "article", title: `${artNo(9)} — Notation et qualité de service` },
    {
      kind: "p",
      text: `Les clients peuvent noter le Partenaire à l'issue de chaque ${unit}. Les notations, taux d'acceptation et signalements participent aux dispositifs de qualité et de sécurité de la Plateforme ; des baisses durables et manifestes de qualité peuvent justifier les mesures de l'article suivant, après information du Partenaire.`,
    },
    {
      kind: "article",
      title: `${artNo(10)} — Suspension (gel) et blocage du compte`,
    },
    {
      kind: "p",
      text: `La Plateforme peut suspendre temporairement (gel) le compte, après notification motivée (immédiate en cas d'urgence), notamment en cas de : dette excédant le plafond de l'article 7 ; documents expirés ; suspicion sérieuse de fraude (fausses ${unit}s, GPS falsifié, comptes multiples) ; comportement dangereux ou signalements graves ; réquisition d'une autorité. Le blocage définitif est réservé aux manquements graves ou répétés. La suspension ne suspend pas l'exigibilité des sommes dues${equip.provided && equip.return_required ? " et la Plateforme peut exiger la restitution immédiate du matériel mis à disposition (Annexe 1)" : ""}.`,
    },
    { kind: "article", title: `${artNo(11)} — Résiliation` },
    {
      kind: "p",
      text: `Chaque partie peut résilier le contrat moyennant le préavis de l'article 3. En cas de manquement grave non réparé dans les quinze (15) jours d'une mise en demeure écrite, la résiliation peut intervenir de plein droit, sans préjudice de dommages et intérêts. La résiliation emporte : fermeture du compte ; apurement des comptes et paiement de toute somme due de part et d'autre${equip.provided && equip.return_required ? " ; restitution du matériel mis à disposition dans les huit (8) jours, à défaut de quoi sa valeur (Annexe 1) est facturée" : ""}. Les stipulations relatives aux paiements, à la preuve et aux données survivent à la fin du contrat.`,
    },
    {
      kind: "article",
      title: `${artNo(12)} — Responsabilité et assurance`,
    },
    {
      kind: "p",
      text: `Le Partenaire est seul responsable de l'exécution des ${unit}s qu'il accepte, de la conduite de son véhicule et des dommages causés par son fait ; il déclare disposer des assurances requises. La responsabilité de la Plateforme, limitée à son rôle d'intermédiaire technique, ne saurait être engagée pour les cas de force majeure (article 127 du code civil), l'interruption des réseaux ou les manquements imputables aux clients${isDriver ? ", aux commerçants" : ""} ou au Partenaire.`,
    },
    {
      kind: "article",
      title: `${artNo(13)} — Données personnelles et confidentialité`,
    },
    {
      kind: "p",
      text: `Chaque partie traite les données personnelles conformément à la loi n° 18-07 du 10 juin 2018. Le Partenaire n'utilise les données des clients (nom, adresse, téléphone) que pour l'exécution de la ${unit} en cours, à l'exclusion de toute conservation ou prospection. Les conditions du présent contrat sont confidentielles.`,
    },
    { kind: "article", title: `${artNo(14)} — Notifications` },
    {
      kind: "p",
      text: "Les notifications sont valablement effectuées par écrit aux adresses figurant en tête des présentes, par voie électronique aux adresses e-mail déclarées ou via l'application, la date d'envoi faisant foi.",
    },
    {
      kind: "article",
      title: `${artNo(15)} — Droit applicable et règlement des litiges`,
    },
    {
      kind: "p",
      text: "Le présent contrat est régi par le droit algérien. Les parties s'efforcent de résoudre amiablement tout différend dans un délai de trente (30) jours à compter de sa notification. À défaut, le litige relève des juridictions algériennes territorialement compétentes conformément au code de procédure civile et administrative.",
    },
    { kind: "article", title: `${artNo(16)} — Dispositions finales` },
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
      text(`CONTRAT DE PARTENARIAT ${roleTitle}`, M, H - 60, 11.5, {
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
    } else {
      para(b.text, { indent: 8, bullet: true });
      y -= 2;
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
        ? "Matériel mis à disposition (propriété de la Plateforme — restitution obligatoire, article 9) :"
        : "Matériel remis au Partenaire (cédé à la remise — aucune restitution exigée) :"
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
    "Signature du Partenaire précédée de la mention manuscrite « lu et approuvé ». Signature de la Plateforme précédée de la même mention."
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
  drawSignBox(M + colW + 24, `Pour le ${role}`, [
    safe(p.full_name),
    `CNI ${safe(p.id_number)} — permis ${safe(p.license_number)}`,
    `Véhicule ${safe(p.vehicle_plate)}`,
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
