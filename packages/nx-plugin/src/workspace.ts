import {lstat,mkdir,writeFile} from 'node:fs/promises';
import {resolve,join,dirname} from 'node:path';
export type DesignSource='none'|'existing';
export type WorkspaceOptions={name:string;directory:string;designSource?:DesignSource;dryRun?:boolean};
const json=(value:unknown)=>JSON.stringify(value,null,2)+'\n';
/** The cohort a new workspace pins; the quality profile is upgraded with it, never copied into the workspace. */
export const COHORT={cli:'0.1.0-dev.18',nxPlugin:'0.1.0-dev.17',workspaceConfig:'0.1.0-dev.0'} as const;
/** Tool versions the quality profile is verified with. */
export const QUALITY_TOOLS={eslint:'10.12.0',prettier:'3.9.9',tsx:'4.23.15'} as const;
/** Workspace scripts. `check` is the gate that CI and the CI-neutral script run. */
export const WORKSPACE_SCRIPTS={
  build:'nx run-many -t build',
  format:'prettier --write .',
  'format:check':'prettier --check .',
  lint:'nx run-many -t lint',
  test:'nx run-many -t test',
  check:'prettier --check . && nx run-many -t lint typecheck test build generated-check catalog-check',
} as const;
// Written in the formatter's own layout so that a new workspace passes its format check.
const nxJson=`{
  "namedInputs": {
    "default": [
      "{projectRoot}/**/*",
      "!{projectRoot}/.next/**/*",
      "!{projectRoot}/node_modules/**/*",
      "!{projectRoot}/runtime-assets/**/*"
    ],
    "sharedGlobals": [
      "{workspaceRoot}/pnpm-lock.yaml",
      "{workspaceRoot}/package.json",
      "{workspaceRoot}/pnpm-workspace.yaml",
      "{workspaceRoot}/eslint.config.mjs",
      "{workspaceRoot}/prettier.config.mjs",
      "{workspaceRoot}/.prettierignore"
    ]
  },
  "targetDefaults": {
    "build": { "inputs": ["default", "sharedGlobals"], "cache": true },
    "typecheck": { "inputs": ["default", "sharedGlobals"], "cache": true },
    "lint": { "inputs": ["default", "sharedGlobals"], "cache": true },
    "test": { "inputs": ["default", "sharedGlobals"], "cache": true },
    "format:check": { "inputs": ["default", "sharedGlobals"], "cache": true },
    "catalog-check": { "inputs": ["default", "sharedGlobals"], "cache": true },
    "format": { "cache": false }
  }
}
`;
const prettierIgnore=`# Tool-owned files keep the layout of the tool that writes them.
pnpm-lock.yaml
pnpm-workspace.yaml
**/.mpfrontend/
.agents/skills/mpfrontend-*/
.claude/skills/mpfrontend-*/
artifacts/
# Hash-bound inputs: a reformatted binding, design export or captured contract reads as drift.
# List the folder of your normalized design export here when you attach one.
**/design.binding.json
contracts/openapi/
# Generated output is checked by generated-check, not by the formatter.
**/generated/
**/*.gen.ts
**/next-env.d.ts
`;
const eslintConfig=`import { workspaceConfig } from '@mpfrontend/workspace-config/eslint';

// The shared MP Frontend profile. Workspace-wide additions go after it; an app or a package
// spreads this array in its own eslint.config.mjs and appends only its own additions.
export default [...workspaceConfig()];
`;
const prettierConfig=`import profile from '@mpfrontend/workspace-config/prettier';

// The shared MP Frontend formatter profile. Add workspace-wide overrides after the spread.
export default { ...profile };
`;
const ciWorkflow=`# Verification only: a frozen install and the uncached workspace check. No deployment or publication.
name: check
on:
  pull_request:
  push:
    branches: [main]
  workflow_dispatch:
permissions:
  contents: read
concurrency:
  group: check-\${{ github.ref }}
  cancel-in-progress: true
jobs:
  check:
    runs-on: ubuntu-latest
    timeout-minutes: 30
    steps:
      - uses: actions/checkout@v7
      - uses: actions/setup-node@v7
        with:
          node-version: '24.19.0'
          package-manager-cache: false
      - name: Install the selected package manager
        run: npm install --global pnpm@11.25.0
      - name: Frozen install and uncached check
        run: sh tools/ci/check.sh
`;
const ciScript=`#!/bin/sh
# CI-neutral workspace gate. Any CI runs this file from the workspace root with Node.js 24.19.0 and
# pnpm 11.25.0 on the path: a frozen install, then the uncached check. It deploys and publishes nothing.
set -eu
export NX_DAEMON=false
export NEXT_TELEMETRY_DISABLED=1
pnpm install --frozen-lockfile
pnpm check --skip-nx-cache
`;
const codeowners=`# Code owners. Replace each placeholder with the owning team before you require code-owner reviews.
*                @owner-placeholder/workspace
/apps/           @owner-placeholder/apps
/packages/       @owner-placeholder/shared-packages
/.agents/skills/ @owner-placeholder/workspace
/.claude/skills/ @owner-placeholder/workspace
`;
const skillsGuide=`# Project and domain skills

Coding agents discover repository skills in this folder. \`mpfrontend skills install\` writes only the
\`mpfrontend-*\` folders here and in \`.claude/skills/\`, records them in \`.mpfrontend/skills-lock.json\`, and
never reads, changes or removes another folder.

Add the workspace's own skills beside them:

- \`project-<topic>/SKILL.md\` for a repository workflow, for example adding an app or reviewing a change.
- \`domain-<topic>/SKILL.md\` for a business procedure that this product owns.

Each \`SKILL.md\` starts with \`name\` and \`description\` metadata, and \`name\` equals the folder name. Copy
each skill to \`.claude/skills/<name>/SKILL.md\` as well, so that both agents find it. The \`mpfrontend-\`
prefix is reserved: \`mpfrontend skills check\` refuses a folder with that prefix that the installer does not
own. A skill calls the workspace generators and \`pnpm check\` instead of repeating their steps.
`;
const agents=`# Consumer workspace

Use pnpm and Nx. Product behavior, DLS bindings and assets stay in this repository; MP Frontend core
remains product-neutral. Read the README and approved API/design contracts before changing behavior.
Preserve authored overrides. Never commit secrets or claim production readiness from a scaffold/build
alone. Repository skills are installed explicitly with mpfrontend skills install; no global
configuration is changed.

Run \`pnpm check\` before a change is reviewed. It runs the format check, then lint, typecheck, test, build,
generated-check and catalog-check of every project. Lint fails on an import across app boundaries, on a raw
colour outside the theme files, on hand-written CSS outside the theme layer and the global style entry, and
on literal user-visible text or translated text joined to other text. Every visible text is a catalog
message; the catalog check fails on a key missing in a locale, an unused key, a key that code uses and the
base does not define, or differing parameters.
Fix the code; do not weaken a rule to pass the check.

Create code with the generators, not by copying: \`mpfrontend create app\`, \`create feature\`,
\`create route\` and \`create package\` (or the matching \`nx g @mpfrontend/nx-plugin:<generator>\`).
A feature lives in \`src/features/<feature>/\` with \`ui/\`, \`model/\`, \`hooks/\`, \`api/\` and \`utils/\`, and
code outside it imports only its \`index.ts\`. Every screen is its own route. Code that two apps need is a
package under \`packages/\`, never a copy. The workspace's own skills follow \`.agents/skills/README.md\`.
`;
/** A neutral Nx/pnpm shell only. Backend contracts, secrets and deployment decisions are not invented. */
export function workspaceFiles(name:string,designSource:DesignSource='none'):Record<string,string>{
  if(!/^[a-z][a-z0-9-]{1,48}$/.test(name))throw new Error('INVALID_WORKSPACE_NAME');
  if(!['none','existing'].includes(designSource))throw new Error('INVALID_DESIGN_SOURCE');
  const designStatus=designSource==='none'?'disabled':'pending';
  return {
    'package.json':json({name,private:true,type:'module',packageManager:'pnpm@11.25.0',engines:{node:'>=24 <25'},
      scripts:WORKSPACE_SCRIPTS,
      devDependencies:{'@mpfrontend/ftg-cli':COHORT.cli,'@mpfrontend/nx-plugin':COHORT.nxPlugin,'@mpfrontend/workspace-config':COHORT.workspaceConfig,eslint:QUALITY_TOOLS.eslint,nx:'23.2.1',prettier:QUALITY_TOOLS.prettier,tsx:QUALITY_TOOLS.tsx,typescript:'5.9.3','@types/node':'24.10.1','@types/react':'19.3.0','@types/react-dom':'19.2.3'}}),
    'pnpm-workspace.yaml':'packages:\n  - apps/*\n  - packages/*\n  - themes/*\noverrides:\n  axios@1.18.1: 1.20.0\n  brace-expansion@5.0.9: 5.0.12\n  smol-toml@1.6.1: 1.9.0\nallowBuilds:\n  "@scarf/scarf": false\n  esbuild: true\n  nx: true\n  sharp: true\n  unrs-resolver: true\n',
    'nx.json':nxJson,
    '.gitignore':'node_modules/\n.next/\n.nx/\ndist/\nruntime-assets/\n*.tsbuildinfo\n.env\n.env.*\n!.env.example\n.mpfrontend/skills-install.lock\n.ftg-write.lock\n',
    '.prettierignore':prettierIgnore,
    'eslint.config.mjs':eslintConfig,
    // The module boundary rule reads the root tsconfig.base.json for path aliases; it extends the shared profile.
    'tsconfig.base.json':json({extends:'@mpfrontend/workspace-config/tsconfig/base.json'}),
    'prettier.config.mjs':prettierConfig,
    '.github/workflows/check.yml':ciWorkflow,
    'tools/ci/check.sh':ciScript,
    'CODEOWNERS':codeowners,
    '.agents/skills/README.md':skillsGuide,
    '.mpfrontend/workspace.json':json({schemaVersion:1,name,orchestrator:'nx',packageManager:'pnpm',runtimeProfile:'unconfigured',designSource,cliVersion:COHORT.cli}),
    '.mpfrontend/design-source.json':json({schemaVersion:1,generator:'MPFrontendDesignSource',cliVersion:COHORT.cli,source:designSource,status:designStatus,binding:null,bindingHash:null,sourceIdentity:null,release:null}),
    'apps/.gitkeep':'','packages/.gitkeep':'','themes/.gitkeep':'',
    'contracts/README.md':'# API ownership\n\nSupply an approved, immutable OpenAPI bundle under openapi/presentation/<app>/openapi.json.\nThe generated catalog example expects listCatalog; configure FTG explicitly for your actual contract.\nNo backend API, permissions or production runtime is generated by workspace initialization.\n',
    'AGENTS.md':agents,
    'CLAUDE.md':'@AGENTS.md\n',
    'README.md':`# ${name}\n\nNeutral MP Frontend Nx/pnpm workspace, initialized with design source \`${designSource}\` without installing dependencies or creating Git history.\n\n1. Install the pinned dependencies with pnpm install. Unpublished development packages require the tested local artifact overrides; no npm availability is claimed.\n2. ${designSource==='none'?'Continue code-first, or attach an approved consumer-owned design source later with mpfrontend design attach.':'Create an approved root design.binding.json for the consumer-owned DLS, then complete the pending source with mpfrontend design attach.'}\n3. Run pnpm exec mpfrontend create app --name customer --directory apps/customer. Add features, routes and shared packages with mpfrontend create feature, create route and create package; replace the placeholder owners in CODEOWNERS.\n4. Supply your approved catalog OpenAPI contract as explained in contracts/README.md.\n5. Install application dependencies, then run pnpm check. Review pnpm-lock.yaml and use frozen installs in CI.\n6. Run pnpm exec mpfrontend skills install --for both --profile base only if repository-scoped agent workflows are wanted. The catalog provides eighteen finite workflows; the base profile installs fourteen.\n\n## Quality profile\n\nThe formatter, lint and TypeScript configuration come from \`@mpfrontend/workspace-config\` and are\nupgraded with the MP Frontend cohort. \`eslint.config.mjs\` and \`prettier.config.mjs\` re-export the shared\nprofile; an app adds only its own additions in its own \`eslint.config.mjs\`.\n\n- \`pnpm format\` formats the workspace; \`pnpm format:check\` only checks it.\n- \`pnpm check\` runs the format check, then lint, typecheck, test, build, generated-check and\n  catalog-check of every project, with Nx caching. Pass \`--skip-nx-cache\` to prove the current source.\n- Every project has \`format\`, \`format:check\`, \`lint\` and \`test\` targets for focused feedback.\n- \`tools/ci/check.sh\` is the CI-neutral gate (a frozen install, then the uncached check);\n  \`.github/workflows/check.yml\` runs it on GitHub Actions.\n\nDesign source modes are explicit: \`existing\` attaches a consumer-owned DLS binding and \`none\` remains code-first. MP Frontend does not ship or require a public Community DLS in this release. Initialization never reads, captures or changes Figma.\n\nThe catalog template is not a protected production application. Configure the security BFF, identity, gateway and realtime boundaries with acceptance tests before protected product adoption.\nProduct DLS, fonts, themes, locale policy, exports, mappings and asset rights are consumer-owned. No Figma access/write, watcher, Git operation, deployment, package publication or global installation is performed.\n\nExisting destinations are refused, including an empty directory or symlink. A filesystem failure may leave a partial new destination for inspection; it is never automatically deleted or retried over.\n`,
  };
}
export async function createWorkspace(options:WorkspaceOptions){
  const designSource=options.designSource??'none',files=workspaceFiles(options.name,designSource),directory=resolve(options.directory);
  try{await lstat(directory);throw new Error('DESTINATION_EXISTS');}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
  if(!options.dryRun){
    // Exclusive directory creation refuses a competing creator; writes never replace an existing file.
    await mkdir(directory,{recursive:false});
    for(const [path,content] of Object.entries(files)){const target=join(directory,path);await mkdir(dirname(target),{recursive:true});await writeFile(target,content,{flag:'wx'});}
  }
  return {ok:true,name:options.name,directory,files:Object.keys(files).sort(),dryRun:options.dryRun===true,runtimeProfile:'unconfigured',designSource};
}
