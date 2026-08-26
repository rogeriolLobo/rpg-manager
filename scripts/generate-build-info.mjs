// Gera src/server/build-info.ts com o commit e horário reais de build, para
// que GET /api/v1/version reflita exatamente o que está publicado — evita o
// tipo de incidente "produção não reflete o código atual" (main == build ==
// deployment == produção, verificável em runtime, sem depender de memória).
import { execSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';

function commitHash() {
  const envSha = process.env.GITHUB_SHA || process.env.CF_PAGES_COMMIT_SHA || process.env.COMMIT_REF;
  if (envSha) return envSha.slice(0, 7);
  try {
    return execSync('git rev-parse --short HEAD').toString().trim();
  } catch {
    return 'unknown';
  }
}

const commit = commitHash();
const time = new Date().toISOString();
const content = `// Gerado automaticamente por scripts/generate-build-info.mjs — não editar à mão.\nexport const BUILD_COMMIT = ${JSON.stringify(commit)};\nexport const BUILD_TIME = ${JSON.stringify(time)};\n`;
writeFileSync(new URL('../src/server/build-info.ts', import.meta.url), content);
console.log(`build-info.ts gerado: commit=${commit} time=${time}`);
