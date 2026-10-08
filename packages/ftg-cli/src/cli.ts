#!/usr/bin/env node
import { generate, InputError } from './index.js';
import { createApplication,createWorkspace,createFeature,createRoute,createPackage,type PackageRuntime } from '@mpfrontend/nx-plugin';
import {skillCatalog,installSkills,checkSkills,SkillsError} from '@mpfrontend/ai-skills';
import {readFileSync} from 'node:fs';
import {designCommand,DesignError} from './design.js';
import {designSourceCommand} from './design-source.js';
import {catalogCheck} from './catalog.js';
const CLI_VERSION=String(JSON.parse(readFileSync(new URL('../package.json',import.meta.url),'utf8')).version);
const args=process.argv.slice(2);
function option(name:string):string|undefined { const index=args.indexOf(name);if(index<0)return undefined;const value=args[index+1];if(!value || value.startsWith('--'))throw new InputError('MISSING_OPTION_VALUE');return value; }
try {
  if(args.includes('--version')){if(args.length!==1)throw new InputError('VERSION_MUST_BE_STANDALONE');console.log(CLI_VERSION);}
  else if(args[0]==='design'){
    const command=args[1];if(!command)throw new InputError('DESIGN_COMMAND_REQUIRED');
    const profiles:Record<string,readonly string[]>={
      import:['--binding','--snapshot','--dry-run','--json'],validate:['--binding','--candidate','--json'],
      diff:['--binding','--candidate','--json'],plan:['--binding','--candidate','--dry-run','--json'],
      apply:['--plan','--dry-run','--json'],accept:['--plan','--evidence','--dry-run','--json'],check:['--binding','--json'],
      attach:['--directory','--source','--binding','--dry-run','--json'],status:['--directory','--json']
    };
    if(!Object.hasOwn(profiles,command))throw new InputError('UNKNOWN_DESIGN_COMMAND');
    const seen=new Set<string>();
    for(let index=2;index<args.length;index++){
      const flag=args[index]!;if(!profiles[command]!.includes(flag))throw new InputError('UNKNOWN_DESIGN_OPTION');
      if(seen.has(flag))throw new InputError('DUPLICATE_DESIGN_OPTION');seen.add(flag);
      if(flag!=='--dry-run'&&flag!=='--json'){const value=args[++index];if(!value||value.startsWith('--'))throw new InputError('MISSING_OPTION_VALUE');}
    }
    if(command==='attach'||command==='status'){
      const directory=option('--directory')??process.cwd(),source=option('--source') as 'none'|'existing'|undefined;
      const bindingPath=option('--binding');
      console.log(JSON.stringify(await designSourceCommand({command,directory,...(source?{source}:{}),...(bindingPath?{bindingPath}:{}),dryRun:args.includes('--dry-run'),cliVersion:CLI_VERSION})));
    }else{
      const inputs={bindingPath:option('--binding'),snapshotPath:option('--snapshot'),candidate:option('--candidate'),planPath:option('--plan'),evidencePath:option('--evidence')};
      const supplied=Object.fromEntries(Object.entries(inputs).filter(([,value])=>value!==undefined));
      console.log(JSON.stringify(await designCommand({command,...supplied,dryRun:args.includes('--dry-run')})));
    }
  }
  else if(args[0]==='catalog'){
    if(args[1]!=='check')throw new InputError('UNKNOWN_CATALOG_COMMAND');
    const allowed=new Set(['--app','--json']),seen=new Set<string>();
    for(let index=2;index<args.length;index++){const flag=args[index]!;if(!allowed.has(flag))throw new InputError('UNKNOWN_CATALOG_OPTION');if(seen.has(flag))throw new InputError('DUPLICATE_CATALOG_OPTION');seen.add(flag);if(flag==='--app'){const value=args[++index];if(!value||value.startsWith('--'))throw new InputError('MISSING_OPTION_VALUE');}}
    const app=option('--app');if(!app)throw new InputError('APP_REQUIRED');
    const result=await catalogCheck(app);console.log(JSON.stringify(result));if(!result.ok)process.exitCode=3;
  }
  else if(args[0]==='init'){
    const allowed=new Set(['--name','--directory','--design-source','--dry-run','--json']),seen=new Set<string>();
    for(let index=1;index<args.length;index++){const flag=args[index]!;if(!allowed.has(flag))throw new InputError('UNKNOWN_INIT_OPTION');if(seen.has(flag))throw new InputError('DUPLICATE_INIT_OPTION');seen.add(flag);if(flag!=='--dry-run'&&flag!=='--json'){const value=args[++index];if(!value||value.startsWith('--'))throw new InputError('MISSING_OPTION_VALUE');}}
    const name=option('--name'),directory=option('--directory');
    if(!name||!directory)throw new InputError('NAME_AND_DIRECTORY_REQUIRED');
    const designSource=(option('--design-source')??'none') as 'none'|'existing';
    console.log(JSON.stringify(await createWorkspace({name,directory,designSource,dryRun:args.includes('--dry-run')})));
  }
  else if(args[0]==='skills'){
    const directory=option('--directory')??process.cwd();
    if(args[1]==='list')console.log(JSON.stringify(skillCatalog()));
    else if(args[1]==='check')console.log(JSON.stringify(await checkSkills(directory)));
    else if(args[1]==='install'||args[1]==='update'){
      const profile=option('--profile') as 'base'|'design'|undefined,agent=option('--for') as 'codex'|'claude'|'both'|undefined;
      console.log(JSON.stringify(await installSkills({directory,...(profile?{profile}:{}),...(agent?{agent}:{}),dryRun:args.includes('--dry-run'),update:args[1]==='update'})));
    }else throw new InputError('UNKNOWN_SKILLS_COMMAND');
  }
  else if(args[0]==='generate'||args[0]==='check') {
    const config=option('--config');if(!config)throw new InputError('CONFIG_REQUIRED');
    const result=await generate(config,{check:args[0]==='check',dryRun:args.includes('--dry-run')});console.log(JSON.stringify(result));
  } else if(args[0]==='create' && args[1]==='app') {
    const name=option('--name'),directory=option('--directory');
    if(!name||!directory)throw new InputError('NAME_AND_DIRECTORY_REQUIRED');
    console.log(JSON.stringify(await createApplication({name,directory,dryRun:args.includes('--dry-run')})));
  } else if(args[0]==='create' && (args[1]==='feature'||args[1]==='route'||args[1]==='package')) {
    const profiles:Record<string,readonly string[]>={feature:['--app','--name','--resource'],route:['--app','--path','--feature','--screen'],package:['--name','--directory','--runtime']};
    const allowed=new Set([...profiles[args[1]]!,'--dry-run','--json']),seen=new Set<string>();
    for(let index=2;index<args.length;index++){const flag=args[index]!;if(!allowed.has(flag))throw new InputError('UNKNOWN_CREATE_OPTION');if(seen.has(flag))throw new InputError('DUPLICATE_CREATE_OPTION');seen.add(flag);if(flag!=='--dry-run'&&flag!=='--json'){const value=args[++index];if(!value||value.startsWith('--'))throw new InputError('MISSING_OPTION_VALUE');}}
    const dryRun=args.includes('--dry-run');
    try{
      if(args[1]==='feature'){
        const app=option('--app'),name=option('--name'),resource=option('--resource');
        if(!app||!name)throw new InputError('APP_AND_NAME_REQUIRED');
        console.log(JSON.stringify(await createFeature({app,name,...(resource?{resource}:{}),dryRun})));
      }else if(args[1]==='route'){
        const app=option('--app'),path=option('--path'),feature=option('--feature'),screen=option('--screen');
        if(!app||!path||!feature)throw new InputError('APP_PATH_AND_FEATURE_REQUIRED');
        console.log(JSON.stringify(await createRoute({app,path,feature,...(screen?{screen}:{}),dryRun})));
      }else{
        const name=option('--name'),directory=option('--directory'),runtime=option('--runtime') as PackageRuntime|undefined;
        if(!name)throw new InputError('NAME_REQUIRED');
        console.log(JSON.stringify(await createPackage({name,...(directory?{directory}:{}),...(runtime?{runtime}:{}),dryRun})));
      }
    }catch(error){if(error instanceof InputError)throw error;throw new InputError(error instanceof Error?error.message:'CREATE_FAILED');}
  } else { console.log('ftg generate|check --config <file> [--dry-run] [--json]\nmpfrontend init --name <name> --directory <new-directory> [--design-source none|existing] [--dry-run] [--json]\nmpfrontend design attach --directory <workspace> --source existing --binding <file> [--dry-run] [--json]\nmpfrontend design status --directory <workspace> [--json]\nmpfrontend create app --name <name> --directory <new-directory> [--dry-run]\nmpfrontend create feature --app <app-directory> --name <feature> [--resource <ftg-resource>] [--dry-run] [--json]\nmpfrontend create route --app <app-directory> --path <route> --feature <feature> [--screen <Export>] [--dry-run] [--json]\nmpfrontend create package --name <name> [--directory packages/<name>] [--runtime universal|client|server] [--dry-run] [--json]\nmpfrontend skills list|install|update|check [--directory <repository>] [--for codex|claude|both] [--profile base|design] [--dry-run] [--json]\nmpfrontend catalog check --app <app-directory> [--json]\nftg --version');process.exitCode=args.length?2:0; }
} catch(error) {
  const code=error instanceof InputError||error instanceof SkillsError||error instanceof DesignError?error.exitCode:2;
  console.error(JSON.stringify({ok:false,code,error:error instanceof Error?error.message:'COMMAND_FAILED'}));process.exitCode=code;
}
