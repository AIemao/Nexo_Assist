import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { TestProject } from "vitest/node";

declare module "vitest" {
    export interface ProvidedContext {
        templateDatabasePath: string;
    }
}

const serviceRoot = fileURLToPath(new URL("../..", import.meta.url));
const prismaCli = createRequire(import.meta.url).resolve("prisma/build/index.js");

// ADR-008, condição 3: migrações aplicadas uma vez por execução, num banco-modelo.
export default function setup(project: TestProject): () => void {
    const dir = mkdtempSync(join(tmpdir(), "nexo-ticket-service-"));
    const templateDatabasePath = join(dir, "template.db");

    try {
        execFileSync(process.execPath, [prismaCli, "migrate", "deploy"], {
            cwd: serviceRoot,
            env: { ...process.env, DATABASE_URL: `file:${templateDatabasePath.replaceAll("\\", "/")}` },
            stdio: "pipe",
        });
    } catch (error) {
        rmSync(dir, { recursive: true, force: true });
        const output = error as { stdout?: Buffer; stderr?: Buffer };
        throw new Error(
            `prisma migrate deploy falhou:\n${output.stdout?.toString() ?? ""}${output.stderr?.toString() ?? ""}`,
            { cause: error },
        );
    }

    project.provide("templateDatabasePath", templateDatabasePath);

    return () => {
        rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    };
}
