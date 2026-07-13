import "./style.css";

const GITHUB_RELEASES_API = "https://api.github.com/repos/iMxSquash/glide/releases/latest";

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

setFooterYear();
void hydrateDownloadSection();
