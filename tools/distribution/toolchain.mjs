// The Node and pnpm that a nested consumer command runs with, and nothing else of the caller's local tools.
import {accessSync,constants,statSync} from 'node:fs';
import {chmod,mkdir,writeFile} from 'node:fs/promises';
import {delimiter,join} from 'node:path';

/** The first executable file called `name` on a PATH value, or undefined. */
export function findExecutable(name,path){
  for(const directory of (path??'').split(delimiter)){
    if(!directory)continue;
    const candidate=join(directory,name);
    try{accessSync(candidate,constants.X_OK);if(statSync(candidate).isFile())return candidate;}catch{}
  }
  return undefined;
}

/**
 * A PATH for nested commands. Every entry that contains node_modules/.bin is removed, so that a nested pnpm
 * or Nx never borrows an executable of the source checkout; the pinned Node (`nodePath`) and the pnpm found
 * on the caller's PATH stay reachable through a private directory that holds only those two, as wrappers
 * that call them by their absolute paths, even when they themselves live in a node_modules/.bin directory.
 */
export async function independentToolchain(directory,{path=process.env.PATH,nodePath=process.execPath}={}){
  const pnpm=findExecutable('pnpm',path);
  if(!pnpm)throw new Error('PNPM_NOT_FOUND');
  const quote=value=>"'"+value.replaceAll("'","'\\''")+"'";
  await mkdir(directory,{recursive:true});
  for(const [name,target] of [['node',nodePath],['pnpm',pnpm]]){
    const wrapper=join(directory,name);
    await writeFile(wrapper,'#!/bin/sh\nexec '+quote(target)+' "$@"\n');
    await chmod(wrapper,0o755);
  }
  const rest=(path??'').split(delimiter).filter(entry=>entry&&!entry.includes('node_modules/.bin'));
  return {path:[directory,...rest].join(delimiter),pnpm};
}
