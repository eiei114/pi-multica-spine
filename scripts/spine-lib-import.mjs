import { access } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

/**
 * Resolve `lib/*.ts` imports for CLI scripts: prefer compiled `dist/lib/*.js`
 * (published tarball) and fall back to TypeScript sources in repo development.
 */
export function spinePackageRoot(fromImportMetaUrl) {
  return join(dirname(fileURLToPath(fromImportMetaUrl)), "..");
}

export async function importSpineLib(fromImportMetaUrl, libRelativePath) {
  const normalized = libRelativePath.replace(/^\.\.\/lib\//, "").replace(/^lib\//, "");
  const root = spinePackageRoot(fromImportMetaUrl);
  const distPath = join(root, "dist/lib", normalized.replace(/\.ts$/, ".js"));
  const tsPath = join(root, "lib", normalized.endsWith(".ts") ? normalized : `${normalized}.ts`);
  try {
    await access(distPath);
    return import(pathToFileURL(distPath).href);
  } catch {
    return import(pathToFileURL(tsPath).href);
  }
}

/** Load multiple lib modules in parallel (dist preferred, ts fallback). */
export async function importSpineLibs(fromImportMetaUrl, libRelativePaths) {
  const mods = await Promise.all(
    libRelativePaths.map((path) => importSpineLib(fromImportMetaUrl, path)),
  );
  return Object.assign({}, ...mods);
}
