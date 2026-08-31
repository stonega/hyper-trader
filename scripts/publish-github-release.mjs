import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { lstat, readdir } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { pathToFileURL } from "node:url";

const GITHUB_API_VERSION = "2026-03-10";
const GITHUB_API_ORIGIN = "https://api.github.com";
const RELEASE_TAG_PATTERN =
  /^v\d+\.\d+\.\d+(?:-[0-9A-Za-z]+(?:[.-][0-9A-Za-z]+)*)?$/;
const REPOSITORY_PATTERN = /^[0-9A-Za-z_.-]+\/[0-9A-Za-z_.-]+$/;
const COMMIT_PATTERN = /^[0-9a-f]{40}$/i;
const ANDROID_ABIS = ["arm64-v8a", "armeabi-v7a", "x86_64", "x86"];

export function assetNameForTag(tag, abi) {
  return `hyper-trader-${tag}-android-${abi}.apk`;
}

export function isPrereleaseTag(tag) {
  return tag.includes("-");
}

export function parseConfig(environment) {
  const token = requiredValue(environment, "GITHUB_RELEASE_TOKEN");
  const repository = requiredValue(environment, "GITHUB_REPOSITORY");
  const tag = requiredValue(environment, "GITHUB_RELEASE_TAG");
  const commit = requiredValue(environment, "GITHUB_RELEASE_COMMIT");
  const apkPath = requiredValue(environment, "ANDROID_APK_PATH");
  const appVersion = requiredValue(environment, "ANDROID_APP_VERSION");

  if (!REPOSITORY_PATTERN.test(repository)) {
    throw new Error("GITHUB_REPOSITORY must use the owner/repository format");
  }
  if (!RELEASE_TAG_PATTERN.test(tag)) {
    throw new Error(
      "GITHUB_RELEASE_TAG must be a semantic version tag such as v1.2.3 or v1.2.3-rc.1",
    );
  }
  if (!COMMIT_PATTERN.test(commit)) {
    throw new Error("GITHUB_RELEASE_COMMIT must be a full Git commit SHA");
  }
  if (tag.split("-")[0] !== `v${appVersion}`) {
    throw new Error(
      `GITHUB_RELEASE_TAG ${tag} does not match Android app version ${appVersion}`,
    );
  }

  return {
    apkPath,
    appVersion,
    commit: commit.toLowerCase(),
    repository,
    tag,
    token,
  };
}

export function verifyExistingAsset(asset, expected) {
  if (asset === undefined) return false;

  const expectedDigest = `sha256:${expected.sha256}`;
  if (asset.digest === expectedDigest && asset.size === expected.size)
    return true;

  throw new Error(
    `GitHub Release already contains ${expected.name} with different contents; refusing to overwrite it`,
  );
}

function requiredValue(environment, name) {
  const value = environment[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function githubHeaders(token, extra = {}) {
  return {
    Accept: "application/vnd.github+json",
    Authorization: `Bearer ${token}`,
    "User-Agent": "hyper-trader-eas-release",
    "X-GitHub-Api-Version": GITHUB_API_VERSION,
    ...extra,
  };
}

async function githubJson(config, path, options = {}) {
  const response = await fetch(`${GITHUB_API_ORIGIN}${path}`, {
    ...options,
    headers: githubHeaders(config.token, options.headers),
  });
  const responseBody = await response.text();

  if (options.allowNotFound && response.status === 404) return undefined;
  if (!response.ok) {
    throw new Error(
      `GitHub API ${options.method ?? "GET"} ${path} failed (${response.status}): ${responseBody.slice(0, 500)}`,
    );
  }

  return responseBody ? JSON.parse(responseBody) : undefined;
}

async function sha256File(path) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);

  return hash.digest("hex");
}

async function verifyArtifact(path) {
  const details = await lstat(path);
  if (!details.isFile() || details.isSymbolicLink() || details.size === 0) {
    throw new Error("ANDROID_APK_PATH must point to a non-empty regular file");
  }
  return { sha256: await sha256File(path), size: details.size };
}

async function collectApkPaths(path) {
  const details = await lstat(path);
  if (details.isSymbolicLink()) {
    throw new Error("ANDROID_APK_PATH must not point to a symbolic link");
  }
  if (details.isFile()) return path.endsWith(".apk") ? [path] : [];
  if (!details.isDirectory()) return [];

  const paths = [];
  for (const entry of await readdir(path, { withFileTypes: true })) {
    const entryPath = join(path, entry.name);
    if (entry.isSymbolicLink()) {
      throw new Error(`APK artifact contains symbolic link ${entryPath}`);
    }
    if (entry.isDirectory()) paths.push(...(await collectApkPaths(entryPath)));
    if (entry.isFile() && entry.name.endsWith(".apk")) paths.push(entryPath);
  }
  return paths;
}

export function abiForApkName(name) {
  const matches = ANDROID_ABIS.filter((abi) => name.includes(`-${abi}-`));
  if (matches.length !== 1) {
    throw new Error(`Could not determine one Android ABI from ${name}`);
  }
  return matches[0];
}

export async function loadArtifacts(path, tag) {
  const details = await lstat(path);
  if (details.isSymbolicLink()) {
    throw new Error("ANDROID_APK_PATH must not point to a symbolic link");
  }

  // eas/download_build extracts a multi-APK archive but returns the first
  // matching APK. Its siblings remain in the same isolated extraction folder.
  const searchPath =
    details.isFile() && path.endsWith(".apk") ? dirname(path) : path;
  const paths = await collectApkPaths(searchPath);
  const artifacts = await Promise.all(
    paths.map(async (apkPath) => {
      const abi = abiForApkName(basename(apkPath));
      return {
        ...(await verifyArtifact(apkPath)),
        abi,
        name: assetNameForTag(tag, abi),
        path: apkPath,
      };
    }),
  );
  const foundAbis = artifacts.map(({ abi }) => abi).sort();
  const expectedAbis = [...ANDROID_ABIS].sort();

  if (
    foundAbis.length !== expectedAbis.length ||
    foundAbis.some((abi, index) => abi !== expectedAbis[index])
  ) {
    throw new Error(
      `Expected one APK for each Android ABI (${expectedAbis.join(", ")}); found ${foundAbis.join(", ") || "none"}`,
    );
  }

  return artifacts;
}

async function verifyTagCommit(config) {
  const tag = encodeURIComponent(config.tag);
  const commit = await githubJson(
    config,
    `/repos/${config.repository}/commits/${tag}`,
  );

  if (commit.sha.toLowerCase() !== config.commit) {
    throw new Error(
      `Git tag ${config.tag} points to ${commit.sha}, but EAS built ${config.commit}`,
    );
  }
}

async function findRelease(config) {
  const tag = encodeURIComponent(config.tag);
  const published = await githubJson(
    config,
    `/repos/${config.repository}/releases/tags/${tag}`,
    { allowNotFound: true },
  );
  if (published !== undefined) return published;

  const releases = await githubJson(
    config,
    `/repos/${config.repository}/releases?per_page=100`,
  );
  return releases.find((release) => release.tag_name === config.tag);
}

async function createDraftRelease(config) {
  return githubJson(config, `/repos/${config.repository}/releases`, {
    body: JSON.stringify({
      draft: true,
      generate_release_notes: true,
      name: `Hyper Trader ${config.tag}`,
      prerelease: isPrereleaseTag(config.tag),
      tag_name: config.tag,
    }),
    headers: { "Content-Type": "application/json" },
    method: "POST",
  });
}

async function publishDraftRelease(config, release) {
  if (!release.draft) return release;

  return githubJson(
    config,
    `/repos/${config.repository}/releases/${release.id}`,
    {
      body: JSON.stringify({
        draft: false,
        prerelease: isPrereleaseTag(config.tag),
      }),
      headers: { "Content-Type": "application/json" },
      method: "PATCH",
    },
  );
}

async function uploadAsset(config, release, asset) {
  const uploadUrl = release.upload_url.replace("{?name,label}", "");
  const response = await fetch(
    `${uploadUrl}?name=${encodeURIComponent(asset.name)}`,
    {
      body: createReadStream(asset.path),
      duplex: "half",
      headers: githubHeaders(config.token, {
        "Content-Length": String(asset.size),
        "Content-Type": "application/vnd.android.package-archive",
      }),
      method: "POST",
    },
  );
  const responseBody = await response.text();

  if (!response.ok) {
    throw new Error(
      `GitHub APK upload failed (${response.status}): ${responseBody.slice(0, 500)}`,
    );
  }

  return responseBody ? JSON.parse(responseBody) : undefined;
}

export async function main(environment = process.env) {
  const config = parseConfig(environment);
  const artifacts = await loadArtifacts(config.apkPath, config.tag);

  await verifyTagCommit(config);

  let release = await findRelease(config);
  if (release === undefined) release = await createDraftRelease(config);

  for (const artifact of artifacts) {
    const existingAsset = release.assets.find(
      (asset) => asset.name === artifact.name,
    );
    if (!verifyExistingAsset(existingAsset, artifact)) {
      await uploadAsset(config, release, artifact);
    }
  }

  release = await publishDraftRelease(config, release);
  for (const artifact of artifacts) {
    console.log(`Published ${artifact.name} (${artifact.sha256})`);
  }
  console.log(`GitHub Release: ${release.html_url}`);
}

const entrypoint = process.argv[1];
if (entrypoint && import.meta.url === pathToFileURL(entrypoint).href) {
  await main();
}
