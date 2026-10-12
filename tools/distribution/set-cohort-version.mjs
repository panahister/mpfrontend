// Moves the whole cohort to one version: the declared version of the root and of every package, every pin of a framework
// package (the application template, the Nx plugin's workspace cohort, the AI procedures and their stated requirement) and
// the two documents that name it. A pattern that is not found is an error, so a new place that names the version cannot be
// missed silently; `release.mjs guard --version <v>` is the check that follows. The API reports are recorded by
// `pnpm api:update`, the changelog by hand.
import {readFile,writeFile,readdir} from 'node:fs/promises';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';

const defaultRoot=fileURLToPath(new URL('../../',import.meta.url));
const VERSION=/^\d+\.\d+\.\d+(-[0-9A-Za-z.]+)?$/;

/** Every change as [path, a function from the old text to the new text, optional]; each must change the text unless it is optional (a procedure that states no requirement). */
export async function setCohortVersion(root,version){
  if(!VERSION.test(version))throw new Error('USAGE: set-cohort-version.mjs <version>');
  const old=JSON.parse(await readFile(join(root,'package.json'),'utf8')).version;
  const packages=(await readdir(join(root,'packages'))).sort();
  const changes=[
    ['package.json',text=>text.replace(/^(  "version": ")[^"]+(",)$/m,'$1'+version+'$2')],
    ...packages.map(name=>['packages/'+name+'/package.json',text=>text.replace(/^(  "version": ")[^"]+(",)$/m,'$1'+version+'$2')]),
    ['packages/nx-plugin/templates/next/package.json.template',text=>text.replace(/^(\s+"@mpfrontend\/[a-z0-9-]+": ")[^"]+(")/gm,'$1'+version+'$2')],
    ['packages/ai-skills/src/index.ts',text=>text.replace(/SKILLS_VERSION='[^']+',SKILLS_CLI_VERSION='[^']+'/,"SKILLS_VERSION='"+version+"',SKILLS_CLI_VERSION='"+version+"'")],
    ['packages/nx-plugin/src/workspace.ts',text=>text.replace(/\{cli:'[^']+',nxPlugin:'[^']+',workspaceConfig:'[^']+'\}/,"{cli:'"+version+"',nxPlugin:'"+version+"',workspaceConfig:'"+version+"'}")],
    ...(await readdir(join(root,'packages/ai-skills/skills'))).sort().map(skill=>['packages/ai-skills/skills/'+skill+'/SKILL.md',
      text=>text.split('\n').map((line,index)=>index===7?line.split(old).join(version):line).join('\n'),true]),
    ['packages/ftg-cli/DESIGN-SYNC.md',text=>text.replace(/^CLI \S+ implements/m,'CLI '+version+' implements')],
    ['.github/ISSUE_TEMPLATE/bug_report.yml',text=>text.replace(/(placeholder: "@mpfrontend\/ftg-cli )[^"]+(")/,'$1'+version+'$2')],
  ];
  const changed=[];
  for(const [path,change,optional] of changes){
    const before=await readFile(join(root,path),'utf8'),after=change(before);
    if(after===before&&!optional&&old!==version)throw new Error('COHORT_VERSION_NOT_FOUND:'+path);
    if(after!==before){await writeFile(join(root,path),after);changed.push(path);}
  }
  return {from:old,to:version,changed};
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===process.argv[1]){
  const result=await setCohortVersion(defaultRoot,process.argv[2]??'');
  console.log(JSON.stringify({ok:true,from:result.from,to:result.to,files:result.changed.length}));
}
