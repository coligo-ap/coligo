import type { Metadata } from "next";
import { Inter } from "next/font/google";
import { APP_CONFIG } from "@/lib/config/app-config";
import { Toaster } from "@/components/ui/toast";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-inter",
});

export const metadata: Metadata = {
  title: `${APP_CONFIG.name} — Espace commerçant`,
  description: APP_CONFIG.description,
};

// Neutralise les attributs ajoutés par certaines extensions de navigateur
// (Bitdefender TrafficLight injecte `bis_skin_checked` / `bis_register` sur
// tous les <div>, ce qui casse l'hydratation React). Le script tourne avant
// l'extension et avant l'hydratation : il bloque les écritures et nettoie
// toute attribute mutation qui passerait quand même.
const KILL_EXTENSION_ATTRS = `
(function(){
  var BLOCKED = ['bis_skin_checked','bis_register'];
  function isBlocked(n){
    if(!n) return false;
    if(BLOCKED.indexOf(n) !== -1) return true;
    if(typeof n.indexOf === 'function' && n.indexOf('__processed_') === 0) return true;
    return false;
  }
  try {
    var proto = Element.prototype;
    var origSet = proto.setAttribute;
    proto.setAttribute = function(name, value){
      if(isBlocked(name)) return;
      return origSet.call(this, name, value);
    };
    var origSetNS = proto.setAttributeNS;
    proto.setAttributeNS = function(ns, name, value){
      if(isBlocked(name)) return;
      return origSetNS.call(this, ns, name, value);
    };
  } catch(e) {}
  function strip(root){
    if(!root || !root.querySelectorAll) return;
    var els = root.querySelectorAll('[bis_skin_checked],[bis_register]');
    for(var i=0;i<els.length;i++){
      els[i].removeAttribute('bis_skin_checked');
      els[i].removeAttribute('bis_register');
    }
  }
  function arm(){
    strip(document.documentElement);
    try {
      new MutationObserver(function(muts){
        for(var i=0;i<muts.length;i++){
          var m = muts[i];
          if(m.type === 'attributes' && isBlocked(m.attributeName) && m.target && m.target.removeAttribute){
            m.target.removeAttribute(m.attributeName);
          } else if(m.type === 'childList' && m.addedNodes){
            for(var j=0;j<m.addedNodes.length;j++) strip(m.addedNodes[j]);
          }
        }
      }).observe(document.documentElement, {
        attributes: true,
        subtree: true,
        childList: true,
        attributeFilter: BLOCKED
      });
    } catch(e) {}
  }
  if(document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', arm, { once: true });
  } else {
    arm();
  }
})();
`;

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="fr" className={inter.variable} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: KILL_EXTENSION_ATTRS }} />
      </head>
      <body className="antialiased" suppressHydrationWarning>
        {children}
        <Toaster />
      </body>
    </html>
  );
}
