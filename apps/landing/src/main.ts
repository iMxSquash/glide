import "./style.css";
import Lenis from "lenis";

const GITHUB_RELEASES_API = "https://api.github.com/repos/iMxSquash/glide/releases/latest";
const THEME_STORAGE_KEY = "glide-theme";

type Theme = "dark" | "light";

interface GithubReleaseAsset {
  name: string;
  browser_download_url: string;
}

interface GithubRelease {
  tag_name: string;
  assets: GithubReleaseAsset[];
}

async function hydrateDownloadSection(): Promise<void> {
  try {
    const response = await fetch(GITHUB_RELEASES_API);
    if (!response.ok) return;

    const release: GithubRelease = await response.json();

    const versionEl = document.querySelector<HTMLElement>("[data-version]");
    if (versionEl && release.tag_name) versionEl.textContent = release.tag_name;

    const windowsAsset = release.assets.find((asset) => asset.name.endsWith(".exe"));
    const macosAsset = release.assets.find((asset) => asset.name.endsWith(".dmg"));

    const windowsLink = document.querySelector<HTMLAnchorElement>("[data-download-windows]");
    if (windowsLink && windowsAsset) windowsLink.href = windowsAsset.browser_download_url;

    const macosLink = document.querySelector<HTMLAnchorElement>("[data-download-macos]");
    if (macosLink && macosAsset) macosLink.href = macosAsset.browser_download_url;
  } catch {
    // Offline or GitHub API unreachable: the static releases/latest links already in the DOM stay as-is.
  }
}

function setFooterYear(): void {
  const yearEl = document.querySelector<HTMLElement>("[data-year]");
  if (yearEl) yearEl.textContent = String(new Date().getFullYear());
}

function getStoredTheme(): Theme | null {
  const stored = localStorage.getItem(THEME_STORAGE_KEY);
  return stored === "dark" || stored === "light" ? stored : null;
}

function systemTheme(): Theme {
  return window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
}

function initThemeToggle(): void {
  const button = document.querySelector<HTMLButtonElement>("[data-theme-toggle]");
  if (!button) return;

  const effectiveTheme = (): Theme => getStoredTheme() ?? systemTheme();

  const syncButton = () => {
    const theme = effectiveTheme();
    button.setAttribute("aria-pressed", String(theme === "light"));
    button.setAttribute("aria-label", theme === "light" ? "Switch to dark mode" : "Switch to light mode");
  };
  syncButton();

  button.addEventListener("click", () => {
    const next: Theme = effectiveTheme() === "light" ? "dark" : "light";
    localStorage.setItem(THEME_STORAGE_KEY, next);
    document.documentElement.setAttribute("data-theme", next);
    syncButton();
  });

  // Live-follow the system theme until the user makes an explicit choice.
  window.matchMedia("(prefers-color-scheme: light)").addEventListener("change", (event) => {
    if (getStoredTheme()) return;
    document.documentElement.setAttribute("data-theme", event.matches ? "light" : "dark");
    syncButton();
  });
}

function prefersReducedMotion(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function initScrollReveal(): void {
  const targets = document.querySelectorAll<HTMLElement>("[data-reveal]");
  if (targets.length === 0) return;

  if (prefersReducedMotion()) return;

  targets.forEach((target) => target.classList.add("is-hidden"));

  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        entry.target.classList.remove("is-hidden");
        entry.target.classList.add("is-visible");
        observer.unobserve(entry.target);
      }
    },
    { threshold: 0.15, rootMargin: "0px 0px -80px 0px" },
  );

  targets.forEach((target) => observer.observe(target));
}

function initSmoothScroll(): Lenis | null {
  if (prefersReducedMotion()) return null;

  const lenis = new Lenis({ duration: 1.1, smoothWheel: true, autoRaf: true });

  document.querySelectorAll<HTMLAnchorElement>('a[href^="#"]').forEach((link) => {
    link.addEventListener("click", (event) => {
      const id = link.getAttribute("href");
      if (!id || id === "#") return;
      const target = document.querySelector(id);
      if (!target) return;
      event.preventDefault();
      lenis.scrollTo(target as HTMLElement, { offset: -16 });
    });
  });

  return lenis;
}

function initParallax(lenis: Lenis | null): void {
  const targets = document.querySelectorAll<HTMLElement>("[data-parallax]");
  if (targets.length === 0 || prefersReducedMotion()) return;

  const update = (scroll: number) => {
    targets.forEach((target) => {
      const speed = Number(target.dataset.parallax) || 0.15;
      target.style.transform = `translate3d(0, ${scroll * speed}px, 0)`;
    });
  };

  if (lenis) {
    lenis.on("scroll", (instance) => update(instance.scroll));
  } else {
    window.addEventListener("scroll", () => update(window.scrollY), { passive: true });
  }
}

setFooterYear();
initThemeToggle();
initScrollReveal();
const lenis = initSmoothScroll();
initParallax(lenis);
void hydrateDownloadSection();
