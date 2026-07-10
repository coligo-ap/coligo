-- Restaure la commission de livraison du livreur à 8 %.
--
-- `platform_settings.driver_fee_rate` valait `0.0000` alors que le DEFAULT de la
-- colonne est `0.08` et que SPEC-COLIGO-PAY décrit 8 % (exemple 1 : sur 300 DA de
-- frais de livraison, Coligo prélève 24 DA, le livreur garde 276). Le livreur
-- encaissait donc 100 % de ses frais, et `npm run verify:spec` échouait sur les
-- trois lignes de l'exemple 1.
--
-- Aucun code applicatif n'écrit ce réglage : `app/admin/drivers/(hub)/contrats`
-- ne fait que le LIRE pour imprimer le taux du contrat. La valeur a donc été
-- mise à zéro à la main. Conséquence à connaître : les contrats livreurs édités
-- entre-temps annonçaient 0 %.
--
-- Ce correctif n'est PAS rétroactif, et c'est voulu : chaque commande fige le
-- taux qui lui a été appliqué dans `orders.driver_fee_rate_applied`. Les
-- commandes passées gardent leur 0 % — on ne réécrit pas une facture émise.

update public.platform_settings
   set driver_fee_rate = 0.08
 where id = true
   and driver_fee_rate = 0;
