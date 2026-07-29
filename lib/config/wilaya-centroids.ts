/**
 * Centroïdes des 58 wilayas (coordonnées du chef-lieu) — référentiel LOCAL
 * pour rattacher un point GPS à sa wilaya SANS réseau (plus proche voisin).
 * Suffisant pour la détection « Inter-wilayas » du Drive (le badge est
 * informatif, jamais tarifaire) ; pour une résolution exacte (zones, admin),
 * rester sur reverseGeocode / resolveWilayaCommune côté serveur.
 *
 * Codes alignés sur lib/config/wilayas.ts (WILAYAS — source des noms fr/ar).
 */
export const WILAYA_CENTROIDS: Record<string, { lat: number; lng: number }> = {
  "01": { lat: 27.87, lng: -0.29 }, // Adrar
  "02": { lat: 36.16, lng: 1.33 }, // Chlef
  "03": { lat: 33.8, lng: 2.87 }, // Laghouat
  "04": { lat: 35.88, lng: 7.11 }, // Oum El Bouaghi
  "05": { lat: 35.56, lng: 6.17 }, // Batna
  "06": { lat: 36.75, lng: 5.06 }, // Béjaïa
  "07": { lat: 34.85, lng: 5.73 }, // Biskra
  "08": { lat: 31.62, lng: -2.22 }, // Béchar
  "09": { lat: 36.47, lng: 2.83 }, // Blida
  "10": { lat: 36.38, lng: 3.9 }, // Bouira
  "11": { lat: 22.79, lng: 5.53 }, // Tamanrasset
  "12": { lat: 35.4, lng: 8.12 }, // Tébessa
  "13": { lat: 34.88, lng: -1.32 }, // Tlemcen
  "14": { lat: 35.37, lng: 1.32 }, // Tiaret
  "15": { lat: 36.71, lng: 4.05 }, // Tizi Ouzou
  "16": { lat: 36.75, lng: 3.06 }, // Alger
  "17": { lat: 34.67, lng: 3.25 }, // Djelfa
  "18": { lat: 36.82, lng: 5.77 }, // Jijel
  "19": { lat: 36.19, lng: 5.41 }, // Sétif
  "20": { lat: 34.83, lng: 0.15 }, // Saïda
  "21": { lat: 36.88, lng: 6.91 }, // Skikda
  "22": { lat: 35.19, lng: -0.63 }, // Sidi Bel Abbès
  "23": { lat: 36.9, lng: 7.77 }, // Annaba
  "24": { lat: 36.46, lng: 7.43 }, // Guelma
  "25": { lat: 36.37, lng: 6.61 }, // Constantine
  "26": { lat: 36.26, lng: 2.75 }, // Médéa
  "27": { lat: 35.93, lng: 0.09 }, // Mostaganem
  "28": { lat: 35.7, lng: 4.54 }, // M'Sila
  "29": { lat: 35.4, lng: 0.14 }, // Mascara
  "30": { lat: 31.95, lng: 5.33 }, // Ouargla
  "31": { lat: 35.7, lng: -0.63 }, // Oran
  "32": { lat: 33.68, lng: 1.02 }, // El Bayadh
  "33": { lat: 26.48, lng: 8.47 }, // Illizi
  "34": { lat: 36.07, lng: 4.76 }, // Bordj Bou Arreridj
  "35": { lat: 36.76, lng: 3.47 }, // Boumerdès
  "36": { lat: 36.77, lng: 8.31 }, // El Tarf
  "37": { lat: 27.67, lng: -8.15 }, // Tindouf
  "38": { lat: 35.61, lng: 1.81 }, // Tissemsilt
  "39": { lat: 33.37, lng: 6.86 }, // El Oued
  "40": { lat: 35.43, lng: 7.14 }, // Khenchela
  "41": { lat: 36.29, lng: 7.95 }, // Souk Ahras
  "42": { lat: 36.59, lng: 2.45 }, // Tipaza
  "43": { lat: 36.45, lng: 6.26 }, // Mila
  "44": { lat: 36.26, lng: 1.97 }, // Aïn Defla
  "45": { lat: 33.27, lng: -0.31 }, // Naâma
  "46": { lat: 35.3, lng: -1.14 }, // Aïn Témouchent
  "47": { lat: 32.49, lng: 3.67 }, // Ghardaïa
  "48": { lat: 35.74, lng: 0.56 }, // Relizane
  "49": { lat: 29.26, lng: 0.23 }, // Timimoun
  "50": { lat: 21.33, lng: 0.95 }, // Bordj Badji Mokhtar
  "51": { lat: 34.42, lng: 5.06 }, // Ouled Djellal
  "52": { lat: 30.13, lng: -2.17 }, // Béni Abbès
  "53": { lat: 27.19, lng: 2.48 }, // In Salah
  "54": { lat: 19.57, lng: 5.77 }, // In Guezzam
  "55": { lat: 33.1, lng: 6.06 }, // Touggourt
  "56": { lat: 24.55, lng: 9.48 }, // Djanet
  "57": { lat: 33.95, lng: 5.92 }, // El M'Ghair
  "58": { lat: 30.58, lng: 2.88 }, // El Menia
};
