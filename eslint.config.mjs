import { dirname } from "path";
import { fileURLToPath } from "url";
import { FlatCompat } from "@eslint/eslintrc";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const compat = new FlatCompat({ baseDirectory: __dirname });

/**
 * Garde-fou anti-couleur-en-dur (mode sombre). Scopé aux SEULS espaces qui ont
 * un vrai mode sombre — client, chauffeur/Drive, livreur. Là, une couleur de
 * surface/texte écrite en dur (hex inline ou classe arbitraire `bg-[#…]`) ne
 * bascule pas avec le thème → texte clair sur fond clair. La règle force le
 * passage par les tokens sémantiques (`bg-surface`, `text-foreground`, `--d-*`…).
 *
 * Niveau « warn » volontaire : ~90 usages hérités (couleurs de marque sur
 * boutons pleins, dégradés décoratifs) sont légitimes et seraient bloquants en
 * « error ». Promouvoir en « error » (+ `eslint --max-warnings 0` en CI) une
 * fois la tokenisation complète. Les espaces commerçant/admin/auth, TOUJOURS
 * clairs, ne sont pas concernés.
 */
const noHardcodedColorRules = {
  "no-restricted-syntax": [
    "warn",
    {
      selector:
        "Property[key.name=/^(color|background|backgroundColor|borderColor|fill|stroke)$/] > Literal[value=/^(#|rgb|hsl)/]",
      message:
        "Couleur écrite en dur dans un style inline. Utilise un token de thème (var(--d-…) ou une classe sémantique bg-surface/text-foreground) pour qu'elle bascule en mode sombre.",
    },
    {
      selector:
        "Literal[value=/(bg|text|border|ring|fill|stroke|from|to|via)-\\[#[0-9a-fA-F]{3,6}\\]/]",
      message:
        "Classe Tailwind de couleur arbitraire (ex. bg-[#fff]). Utilise un token de thème (bg-surface, text-foreground, bg-[var(--d-…)]) pour s'adapter au mode sombre.",
    },
    {
      selector:
        "JSXAttribute[name.name='className'] Literal[value=/\\b(text|bg)-(white|black)\\b/]",
      message:
        "text-white/bg-white/text-black/bg-black en dur ne bascule pas en sombre. Utilise les tokens (text-foreground, bg-surface). `text-white` n'est légitime QUE sur une surface colorée pleine (bouton violet) — déplace-le dans un composant thémé partagé.",
    },
  ],
};

const eslintConfig = [
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  {
    files: [
      "components/customer/**/*.{ts,tsx}",
      "components/chauffeur/**/*.{ts,tsx}",
      "components/driver/**/*.{ts,tsx}",
      "app/(customer)/**/*.{ts,tsx}",
      "app/(chauffeur)/**/*.{ts,tsx}",
      "app/(driver)/**/*.{ts,tsx}",
    ],
    rules: noHardcodedColorRules,
  },
];

export default eslintConfig;
