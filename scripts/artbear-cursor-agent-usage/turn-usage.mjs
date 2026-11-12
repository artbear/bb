// Injected into cursor-agent 2026.11.11-b912975. One source for the patch and the tests.
export const MARKER = "bb-cursor-usage-patch-1";

export const methodsSource = `bbNoteTurnEnded(t){/*${MARKER}*/
const m=t&&t.message;if(!m||m.case!=="turnEnded"||m.value==null)return;
const v=m.value;
const take=x=>{if(x===undefined||x===null)return{state:"absent"};const n=Number(x);return Number.isSafeInteger(n)&&n>=0?{state:"value",value:n}:{state:"bad"}};
const input=take(v.inputTokens),output=take(v.outputTokens),read=take(v.cacheReadTokens),write=take(v.cacheWriteTokens),thought=take(v.reasoningTokens);
if(input.state==="absent"&&output.state==="absent"&&read.state==="absent"&&write.state==="absent"&&thought.state==="absent")return;
if(this.bbSeen&&this.bbSeen.has(v))return;
this.bbSeen||(this.bbSeen=new Set);this.bbSeen.add(v);
if(input.state==="bad"||output.state==="bad"){this.bbPromptBad=!0;return}
if(input.state!=="value"||output.state!=="value")return;
const d=this.bbDelta||(this.bbDelta={input:0,output:0});
if(!Number.isSafeInteger(d.input+input.value)||!Number.isSafeInteger(d.output+output.value)){this.bbPromptBad=!0;return}
d.input+=input.value;d.output+=output.value;
const add=(key,part)=>{if(part.state!=="value")return;const next=(d[key]??0)+part.value;if(!Number.isSafeInteger(next)){this.bbPromptBad=!0;return}d[key]=next};
add("read",read);add("write",write);add("thought",thought);
if(!this.bbPromptBad)this.bbPromptAdded=!0}
bbResetPrompt(){this.bbDelta=null;this.bbPromptAdded=!1;this.bbPromptBad=!1;this.bbSeen=new Set}
bbPromptUsage(){let usage;if(!this.bbPromptBad&&this.bbPromptAdded&&this.bbDelta){const d=this.bbDelta,s=this.bbSession||{input:0,output:0};const ni=s.input+d.input,no=s.output+d.output;if(Number.isSafeInteger(ni)&&Number.isSafeInteger(no)){const opt=(key)=>{if(d[key]===undefined)return!0;const next=(s[key]??0)+d[key];if(!Number.isSafeInteger(next))return!1;return next};const nr=opt("read"),nw=opt("write"),nt=opt("thought");if(nr!==!1&&nw!==!1&&nt!==!1){s.input=ni;s.output=no;if(nr!==!0)s.read=nr;if(nw!==!0)s.write=nw;if(nt!==!0)s.thought=nt;this.bbSession=s;usage={inputTokens:s.input,outputTokens:s.output,totalTokens:s.input+s.output};if(s.read!==undefined)usage.cachedReadTokens=s.read;if(s.write!==undefined)usage.cachedWriteTokens=s.write;if(s.thought!==undefined)usage.thoughtTokens=s.thought}}}this.bbResetPrompt();return usage?{usage}:{}}
async bbSendContextUsage(){try{const d=this.agentStore.getConversationStateStructure()?.tokenDetails,used=d?.usedTokens,size=d?.maxTokens;if(typeof used!="number"||typeof size!="number"||!Number.isFinite(used)||!Number.isFinite(size)||!Number.isSafeInteger(used)||!Number.isSafeInteger(size)||used<0||size<=0)return;await this.sendSessionUpdate({sessionUpdate:"usage_update",used,size})}catch{}}
`;

export function createSession() {
  const Session = new Function(`return class Session { ${methodsSource} }`)();
  return new Session();
}
