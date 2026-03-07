import fs from "node:fs";
import path from "node:path";

const rootDir = process.cwd();
const nodeModulesDir = path.join(rootDir, "node_modules");
const pnpmDir = path.join(nodeModulesDir, ".pnpm");
const packageJsonPath = path.join(rootDir, "package.json");

if (!fs.existsSync(packageJsonPath)) {
  console.error("package.json not found in current directory.");
  process.exit(1);
}

if (!fs.existsSync(pnpmDir)) {
  console.error("node_modules/.pnpm not found.");
  process.exit(1);
}

const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));
const dependencyNames = new Set([
  ...Object.keys(packageJson.dependencies ?? {}),
  ...Object.keys(packageJson.optionalDependencies ?? {}),
  ...Object.keys(packageJson.devDependencies ?? {}),
]);

const pnpmEntries = fs
  .readdirSync(pnpmDir, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name);

const sharedNodeModulesDir = path.join(pnpmDir, "node_modules");
fs.mkdirSync(sharedNodeModulesDir, { recursive: true });

const packageTargets = new Map();

for (const entryName of pnpmEntries) {
  if (entryName === "node_modules") {
    continue;
  }
  const entryNodeModulesDir = path.join(pnpmDir, entryName, "node_modules");
  if (!fs.existsSync(entryNodeModulesDir)) {
    continue;
  }

  const level1 = fs.readdirSync(entryNodeModulesDir, { withFileTypes: true });
  for (const child of level1) {
    if (!child.isDirectory()) {
      continue;
    }
    if (child.name === ".bin") {
      continue;
    }

    if (child.name.startsWith("@")) {
      const scopeDir = path.join(entryNodeModulesDir, child.name);
      const scopedChildren = fs.readdirSync(scopeDir, { withFileTypes: true });
      for (const scopedChild of scopedChildren) {
        if (!scopedChild.isDirectory()) {
          continue;
        }
        const packageName = `${child.name}/${scopedChild.name}`;
        const targetDir = path.join(scopeDir, scopedChild.name);
        if (!packageTargets.has(packageName)) {
          packageTargets.set(packageName, targetDir);
        }
      }
      continue;
    }

    const packageName = child.name;
    const targetDir = path.join(entryNodeModulesDir, packageName);
    if (!packageTargets.has(packageName)) {
      packageTargets.set(packageName, targetDir);
    }
  }
}

let sharedCreated = 0;
let directCreated = 0;
let missing = 0;

function createLink(baseDir, packageName, targetDir) {
  const linkPath = path.join(baseDir, ...packageName.split("/"));
  if (fs.existsSync(linkPath)) {
    return false;
  }
  fs.mkdirSync(path.dirname(linkPath), { recursive: true });
  try {
    fs.symlinkSync(targetDir, linkPath, "junction");
    return true;
  } catch (error) {
    if (error.code === "EEXIST") {
      return false;
    }
    throw error;
  }
}

for (const [packageName, targetDir] of packageTargets.entries()) {
  if (createLink(sharedNodeModulesDir, packageName, targetDir)) {
    sharedCreated += 1;
  }
}

for (const packageName of dependencyNames) {
  const targetPackageDir = packageTargets.get(packageName);
  if (!targetPackageDir) {
    missing += 1;
    continue;
  }
  if (createLink(nodeModulesDir, packageName, targetPackageDir)) {
    directCreated += 1;
  }
}

console.log(
  `Repaired links from .pnpm store (shared: ${sharedCreated}, direct: ${directCreated}). Missing direct packages: ${missing}.`,
);
