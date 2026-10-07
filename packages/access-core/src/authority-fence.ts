/** A UI publication fence, never an authorization decision. Servers still enforce every request. */
export class AuthorityFence {
  private identity:string|null=null;
  private controller=new AbortController();
  update(identity:string|null):void {
    if(identity===this.identity)return;
    this.controller.abort(new DOMException('AUTHORITY_CHANGED','AbortError'));
    this.controller=new AbortController();this.identity=identity;
  }
  capture(expectedIdentity:string):Readonly<{signal:AbortSignal;assertCurrent:()=>void}> {
    const controller=this.controller;
    const assertCurrent=()=>{
      if(!this.identity||this.identity!==expectedIdentity||controller!==this.controller||controller.signal.aborted)
        throw new DOMException('AUTHORITY_CHANGED','AbortError');
    };
    assertCurrent();return {signal:controller.signal,assertCurrent};
  }
}
