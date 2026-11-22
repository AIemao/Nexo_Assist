// Fronteira servidor/cliente (ADR-013; plano T2, proteção principal). Percorre os arquivos com a
// diretiva "use client" e segue os imports transitivos, resolvendo os caminhos relativos e os
// aliases do tsconfig ("paths"). Acusa quando o grafo de um componente cliente alcança
// src/server/**, src/generated/** ou um pacote só de servidor.
//
// Leitura textual dos imports, sem a API do compilador (o TypeScript 7 não a expõe como antes).
// Conservador: imports de tipo e imports dentro de comentários também contam. Tipos compartilhados
// com o cliente não ficam em src/server/.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";

export interface BoundaryViolation {
  clientFile: string;
  chain: string[];
  reached: string;
}

export interface BoundaryReport {
  clientFiles: string[];
  violations: BoundaryViolation[];
}

const SOURCE_EXTENSIONS = [".ts", ".tsx", ".js", ".jsx", ".mjs"];
const FORBIDDEN_DIRS = ["server", "generated"];

// Pacotes que só podem existir no servidor (ADR-013).
export function isForbiddenPackage(specifier: string): boolean {
  return (
    specifier.startsWith("@prisma/") ||
    specifier === "prisma" ||
    specifier.startsWith("prisma/") ||
    specifier === "better-sqlite3" ||
    specifier.startsWith("better-sqlite3/") ||
    specifier.startsWith("@mastra/")
  );
}

const IMPORT_PATTERNS = [
  /(?:import|export)\s[^'";]*?\sfrom\s*['"]([^'"]+)['"]/g,
  /\bimport\s*['"]([^'"]+)['"]/g,
  /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  /\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
];

export function importSpecifiers(source: string): string[] {
  const found = new Set<string>();
  for (const pattern of IMPORT_PATTERNS) {
    for (const match of source.matchAll(pattern)) {
      const specifier = match[1];
      if (specifier !== undefined) found.add(specifier);
    }
  }
  return [...found];
}

// A diretiva precisa ser a primeira instrução do arquivo (antes dela, só comentários).
export function hasUseClientDirective(source: string): boolean {
  const withoutLeadingComments = source.replace(/^(?:\s|\/\/[^\n]*\n|\/\*[\s\S]*?\*\/)*/, "");
  return /^['"]use client['"]/.test(withoutLeadingComments);
}

function listSourceFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const files: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...listSourceFiles(path));
    else if (SOURCE_EXTENSIONS.some((ext) => entry.name.endsWith(ext))) files.push(path);
  }
  return files;
}

function resolveFile(base: string): string | undefined {
  const candidates = [base, ...SOURCE_EXTENSIONS.map((ext) => base + ext)];
  // Import com extensão .js de um arquivo .ts/.tsx (convenção do ESM com TypeScript).
  if (/\.(?:m?js|jsx)$/.test(base)) {
    const stem = base.replace(/\.(?:m?js|jsx)$/, "");
    candidates.push(stem + ".ts", stem + ".tsx");
  }
  for (const candidate of candidates) {
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  }
  for (const ext of SOURCE_EXTENSIONS) {
    const index = join(base, `index${ext}`);
    if (existsSync(index)) return index;
  }
  return undefined;
}

type Paths = Record<string, string[]>;

// Lê "compilerOptions.paths" do tsconfig.json (JSON sem comentários).
export function readTsconfigPaths(root: string): Paths {
  const tsconfigPath = join(root, "tsconfig.json");
  if (!existsSync(tsconfigPath)) return {};
  const parsed: unknown = JSON.parse(readFileSync(tsconfigPath, "utf8"));
  if (typeof parsed !== "object" || parsed === null) return {};
  const compilerOptions = (parsed as { compilerOptions?: { paths?: Paths } }).compilerOptions;
  return compilerOptions?.paths ?? {};
}

type Resolution = { kind: "file"; path: string } | { kind: "package"; name: string } | { kind: "unresolved" };

function resolveSpecifier(specifier: string, fromFile: string, root: string, paths: Paths): Resolution {
  if (specifier.startsWith("./") || specifier.startsWith("../")) {
    const path = resolveFile(resolve(dirname(fromFile), specifier));
    return path === undefined ? { kind: "unresolved" } : { kind: "file", path };
  }
  for (const [pattern, targets] of Object.entries(paths)) {
    const star = pattern.indexOf("*");
    const prefix = star === -1 ? pattern : pattern.slice(0, star);
    const suffix = star === -1 ? "" : pattern.slice(star + 1);
    const matches =
      star === -1 ? specifier === pattern : specifier.startsWith(prefix) && specifier.endsWith(suffix);
    if (!matches) continue;
    const captured = star === -1 ? "" : specifier.slice(prefix.length, specifier.length - suffix.length);
    for (const target of targets) {
      const path = resolveFile(resolve(root, target.replace("*", captured)));
      if (path !== undefined) return { kind: "file", path };
    }
    return { kind: "unresolved" };
  }
  return { kind: "package", name: specifier };
}

function isInside(file: string, dir: string): boolean {
  const rel = relative(dir, file);
  return rel !== "" && !rel.startsWith("..") && !rel.startsWith(sep) && !/^[A-Za-z]:/.test(rel);
}

export function checkClientBoundary(root: string, srcDir = join(root, "src")): BoundaryReport {
  const paths = readTsconfigPaths(root);
  const forbiddenDirs = FORBIDDEN_DIRS.map((dir) => join(srcDir, dir));
  const show = (file: string) => relative(root, file).split(sep).join("/");

  const clientFiles = listSourceFiles(srcDir).filter((file) => hasUseClientDirective(readFileSync(file, "utf8")));
  const violations: BoundaryViolation[] = [];

  for (const clientFile of clientFiles) {
    const visited = new Set<string>([clientFile]);
    const stack: { file: string; chain: string[] }[] = [{ file: clientFile, chain: [show(clientFile)] }];
    while (stack.length > 0) {
      const current = stack.pop();
      if (current === undefined) break;
      for (const specifier of importSpecifiers(readFileSync(current.file, "utf8"))) {
        const resolution = resolveSpecifier(specifier, current.file, root, paths);
        if (resolution.kind === "package") {
          if (isForbiddenPackage(resolution.name)) {
            violations.push({ clientFile: show(clientFile), chain: current.chain, reached: resolution.name });
          }
          continue;
        }
        if (resolution.kind !== "file") continue;
        const target = resolution.path;
        if (forbiddenDirs.some((dir) => isInside(target, dir))) {
          violations.push({ clientFile: show(clientFile), chain: current.chain, reached: show(target) });
          continue;
        }
        if (target.split(sep).includes("node_modules") || visited.has(target)) continue;
        visited.add(target);
        stack.push({ file: target, chain: [...current.chain, show(target)] });
      }
    }
  }

  return { clientFiles: clientFiles.map(show), violations };
}
