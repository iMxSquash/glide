import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";

// 100dvh ne se remet pas toujours à jour à temps quand la barre d'adresse Safari
// se rétracte après le chargement initial (elle démarre déployée), laissant un
// espace vide au-dessus du contenu tant qu'aucun repaint n'est déclenché.
// window.visualViewport reflète la hauteur visible réelle en direct.
function syncAppHeight(): void {
  const height = window.visualViewport?.height ?? window.innerHeight;
  document.documentElement.style.setProperty("--app-height", `${height}px`);

  // iOS (surtout en PWA standalone) fait défiler la page entière quand le
  // clavier virtuel s'ouvre, et laisse parfois ce décalage traîner ensuite :
  // le contenu remonte hors écran et un espace vide apparaît en haut. Comme
  // l'app tient dans --app-height, il n'y a jamais rien à scroller — on
  // ré-ancre systématiquement la page en haut.
  if (window.scrollY !== 0 || (window.visualViewport?.offsetTop ?? 0) !== 0) {
    window.scrollTo(0, 0);
  }
}

syncAppHeight();
window.visualViewport?.addEventListener("resize", syncAppHeight);
window.visualViewport?.addEventListener("scroll", syncAppHeight);
window.addEventListener("resize", syncAppHeight);
window.addEventListener("orientationchange", syncAppHeight);
window.addEventListener("pageshow", syncAppHeight);
document.addEventListener("visibilitychange", syncAppHeight);

// L'ouverture/fermeture du clavier virtuel est déclenchée par le focus d'un
// input ; l'animation iOS dure ~250ms et les events resize arrivent parfois
// avant la valeur finale — on re-vérifie une fois l'animation terminée.
document.addEventListener("focusin", () => setTimeout(syncAppHeight, 300));
document.addEventListener("focusout", () => setTimeout(syncAppHeight, 300));

// La barre d'adresse Safari termine parfois son animation de rétractation sans
// émettre d'event "resize" exploitable juste après le chargement : quelques
// re-vérifications différées rattrapent la valeur une fois qu'elle s'est posée.
requestAnimationFrame(syncAppHeight);
[100, 300, 600, 1200].forEach((delay) => setTimeout(syncAppHeight, delay));

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
