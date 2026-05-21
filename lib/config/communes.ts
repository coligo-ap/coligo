/**
 * Mapping wilayaCode → liste de communes principales.
 * Dataset starter : couvre les chefs-lieux et grandes agglomérations.
 * Pour les wilayas sans entrée, la saisie libre reste disponible.
 */
export const COMMUNES_BY_WILAYA: Record<string, string[]> = {
  "01": ["Adrar", "Reggane", "Timimoun", "Aoulef", "Bouda", "Fenoughil", "Tamentit", "Tinerkouk", "Zaouiet Kounta"],
  "02": ["Chlef", "Ténès", "Boukadir", "Oued Fodda", "Ouled Farès", "Sobha", "El Karimia", "Beni Haoua"],
  "03": ["Laghouat", "Aflou", "Ksar El Hirane", "Hassi R'Mel", "Brida", "Sidi Makhlouf", "Hassi Delaa"],
  "04": ["Oum El Bouaghi", "Aïn Beïda", "Aïn M'Lila", "Aïn Kercha", "Meskiana", "Sigus", "F'kirina", "Souk Naamane"],
  "05": ["Batna", "Barika", "Arris", "Merouana", "N'Gaous", "Tazoult", "Aïn Touta", "Seriana", "Timgad", "Ouled Si Slimane"],
  "06": ["Béjaïa", "Akbou", "El Kseur", "Amizour", "Sidi Aïch", "Kherrata", "Aokas", "Tichy", "Tazmalt", "Souk El Tenine", "Seddouk", "Beni Maouche", "Adekar", "Darguina", "Toudja", "Ouzellaguen"],
  "07": ["Biskra", "Ouled Djellal", "Tolga", "Sidi Okba", "El Kantara", "Zeribet El Oued", "Foughala", "M'Chouneche"],
  "08": ["Béchar", "Kenadsa", "Beni Ounif", "Taghit", "Abadla", "Igli", "Lahmar", "Boukais"],
  "09": ["Blida", "Boufarik", "Mouzaïa", "Oued El Alleug", "Larbaa", "Bouinan", "Soumaa", "Chréa", "Chebli", "Béni Tamou"],
  "10": ["Bouira", "Lakhdaria", "Sour El Ghozlane", "M'Chedallah", "Aïn Bessem", "El Hachimia", "Bechloul", "Bordj Okhriss", "Haïzer", "Aomar"],
  "11": ["Tamanrasset", "In Salah", "Tin Zaouatine", "Idles", "Abalessa", "In Ghar"],
  "12": ["Tébessa", "Bir El Ater", "Cheria", "El Aouinet", "Ouenza", "Morsott", "Bekkaria", "Hammamet"],
  "13": ["Tlemcen", "Maghnia", "Remchi", "Ghazaouet", "Nedroma", "Mansourah", "Sebra", "Hennaya", "Ouled Mimoun", "Sebdou"],
  "14": ["Tiaret", "Sougueur", "Frenda", "Mahdia", "Aïn Deheb", "Ksar Chellala", "Rahouia", "Dahmouni"],
  "15": ["Tizi Ouzou", "Azazga", "Draâ El Mizan", "Boghni", "Larbaâ Nath Irathen", "Tigzirt", "Ouacifs", "Ouaguenoun", "Aïn El Hammam", "Maâtkas", "Iferhounène", "Beni Yenni", "Beni Douala"],
  "16": [
    "Alger Centre", "Sidi M'Hamed", "El Madania", "Hamma El Annasser", "Bab El Oued", "Bologhine", "Casbah", "Oued Koriche",
    "Bir Mourad Raïs", "El Biar", "Bouzaréah", "Birkhadem", "El Harrach", "Baraki", "Oued Smar", "Bachdjarrah",
    "Hussein Dey", "Kouba", "Bourouba", "Dar El Beïda", "Bab Ezzouar", "Ben Aknoun", "Dely Ibrahim", "Hammamet",
    "Raïs Hamidou", "Djasr Kasentina", "El Mouradia", "Hydra", "Mohammadia", "Bordj El Kiffan", "El Magharia",
    "Beni Messous", "Les Eucalyptus", "Birtouta", "Tessala El Merdja", "Ouled Chebel", "Sidi Moussa", "Aïn Taya",
    "Bordj El Bahri", "El Marsa", "Heuraoua", "Rouiba", "Reghaïa", "Aïn Benian", "Staoueli", "Zeralda",
    "Mahelma", "Rahmania", "Souidania", "Cheraga", "Ouled Fayet", "El Achour", "Draria", "Douera", "Baba Hassen",
    "Khraicia", "Saoula"
  ],
  "17": ["Djelfa", "Messaad", "Aïn Oussera", "Hassi Bahbah", "Birine", "Charef", "Sidi Ladjel", "Had Sahary"],
  "18": ["Jijel", "Taher", "El Milia", "Chekfa", "El Aouana", "Texenna", "Settara", "Sidi Maarouf", "Ziama Mansouriah"],
  "19": ["Sétif", "El Eulma", "Aïn Oulmène", "Aïn Arnat", "Bougaâ", "Aïn Azel", "Beni Aziz", "Aïn El Kebira", "Salah Bey", "Beidha Bordj", "Guidjel", "Hammam Sokhna"],
  "20": ["Saïda", "Aïn El Hadjar", "Youb", "Hassasna", "Sidi Boubekeur", "Ouled Brahim"],
  "21": ["Skikda", "Collo", "Azzaba", "El Harrouch", "Ramdane Djamel", "Sidi Mezghiche", "Beni Bechir", "Filfila", "Tamalous"],
  "22": ["Sidi Bel Abbès", "Telagh", "Ras El Ma", "Sfisef", "Ben Badis", "Marhoum", "Sidi Lahcene", "Tessala"],
  "23": ["Annaba", "El Hadjar", "El Bouni", "Sidi Amar", "Berrahal", "Aïn Berda", "Chetaibi", "Seraidi"],
  "24": ["Guelma", "Oued Zenati", "Héliopolis", "Bouchegouf", "Hammam Debagh", "Aïn Hessainia", "Khezarra", "Aïn Larbi"],
  "25": ["Constantine", "El Khroub", "Hamma Bouziane", "Aïn Smara", "Didouche Mourad", "Ibn Ziad", "Zighoud Youcef", "Ouled Rahmoune", "Beni H'Midène"],
  "26": ["Médéa", "Berrouaghia", "Tablat", "Beni Slimane", "Ksar El Boukhari", "Ouzera", "El Omaria", "Aziz", "Aïn Boucif"],
  "27": ["Mostaganem", "Aïn Tedles", "Bouguirat", "Sidi Lakhdar", "Hassi Mameche", "Sour", "Mesra", "Achaacha"],
  "28": ["M'Sila", "Boussaâda", "Magra", "Sidi Aïssa", "Aïn El Melh", "Hammam Dalaâ", "Khoubana", "Ben Srour"],
  "29": ["Mascara", "Sig", "Mohammadia", "Tighennif", "Bouhanifia", "Hacine", "Ghriss", "Tizi", "Oued El Abtal", "Aïn Fares"],
  "30": ["Ouargla", "Hassi Messaoud", "Touggourt", "N'Goussa", "Rouissat", "Sidi Khouiled", "Aïn Beïda"],
  "31": ["Oran", "Es Sénia", "Bir El Djir", "Aïn El Turck", "Arzew", "Bethioua", "Mers El Kébir", "Sidi Chami", "Hassi Bounif", "Boutlélis", "Boufatis", "Misserghin", "El Ançor", "Gdyel", "Hassi Ben Okba"],
  "32": ["El Bayadh", "Bougtoub", "Brezina", "Boualem", "Stitten", "El Abiodh Sidi Cheikh", "Rogassa"],
  "33": ["Illizi", "Djanet", "Bordj El Houas", "In Aménas", "Debdeb", "Bordj Omar Driss"],
  "34": ["Bordj Bou Arreridj", "Ras El Oued", "El M'Hir", "Bordj Zemmoura", "Mansoura", "Medjana", "El Achir", "Ouled Brahem", "Sidi Embarek"],
  "35": ["Boumerdès", "Boudouaou", "Bordj Menaïel", "Dellys", "Khemis El Khechna", "Larbaâ Naït Irathen", "Naciria", "Thénia", "Reghaïa", "Issers", "Tidjelabine", "Corso"],
  "36": ["El Tarf", "El Kala", "Bouhadjar", "Dréan", "Ben M'Hidi", "Bouteldja", "Besbes", "Chebaita Mokhtar"],
  "37": ["Tindouf", "Oum El Assel"],
  "38": ["Tissemsilt", "Theniet El Had", "Bordj Bou Naâma", "Khemisti", "Lardjem", "Boucaid", "Lazharia"],
  "39": ["El Oued", "Robbah", "Bayadha", "Hassi Khalifa", "Reguiba", "Guemar", "Debila", "Magrane", "Kouinine"],
  "40": ["Khenchela", "Kaïs", "Chelia", "Bouhmama", "El Hamma", "Babar", "Tamza", "M'Sara"],
  "41": ["Souk Ahras", "Sedrata", "M'Daourouch", "Heddada", "Taoura", "Bir Bouhouche", "Oued Keberit"],
  "42": ["Tipaza", "Hadjout", "Bou Ismaïl", "Cherchell", "Koléa", "Damous", "Gouraya", "Fouka", "Ahmer El Aïn", "Sidi Amar", "Sidi Rached", "Bourkika"],
  "43": ["Mila", "Ferdjioua", "Chelghoum Laïd", "Oued Athmania", "Tadjenanet", "Grarem Gouga", "Sidi Merouane", "Tassadane Haddada"],
  "44": ["Aïn Defla", "Khemis Miliana", "Miliana", "El Attaf", "Bordj Emir Khaled", "Djelida", "Aïn Lechiakh", "Boumedfaa"],
  "45": ["Naâma", "Mécheria", "Aïn Sefra", "Tiout", "Moghrar", "Asla", "Sfissifa"],
  "46": ["Aïn Témouchent", "Hammam Bou Hadjar", "Beni Saf", "El Amria", "El Malah", "Oulhaça El Gheraba", "Aïn Kihal"],
  "47": ["Ghardaïa", "Métlili", "El Ménia", "Berriane", "Bounoura", "El Atteuf", "Daïa Ben Dahoua", "Guerrara", "Zelfana"],
  "48": ["Relizane", "Oued Rhiou", "Mazouna", "Ammi Moussa", "Sidi M'Hamed Ben Ali", "El Matmar", "Yellel", "Zemmoura"],
  "49": ["Timimoun", "Aougrout", "Charouine", "Ouled Saïd", "Tinerkouk"],
  "50": ["Bordj Baji Mokhtar", "Timiaouine"],
  "51": ["Ouled Djellal", "Sidi Khaled", "Doucen", "Chaiba", "Besbes"],
  "52": ["Béni Abbès", "Tabelbala", "Kerzaz", "El Ouata", "Ksabi"],
  "53": ["In Salah", "Foggaret Ezzaouia", "In Ghar"],
  "54": ["In Guezzam", "Tin Zaouatine"],
  "55": ["Touggourt", "Témacine", "Nezla", "Megarine", "Zaouia El Abidia", "Tebesbest"],
  "56": ["Djanet", "Bordj El Houas"],
  "57": ["El M'Ghair", "Djamaa", "Sidi Khellil", "Still", "Oum Touyour"],
  "58": ["El Meniaa", "Hassi Gara", "Hassi El Fhal"],
};

/**
 * Retourne la liste des communes pour un wilaya, ou tableau vide si non listée.
 */
export function getCommunes(wilayaCode: string): string[] {
  return COMMUNES_BY_WILAYA[wilayaCode] ?? [];
}
