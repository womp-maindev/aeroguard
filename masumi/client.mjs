import { Client } from 'eve/client';
import { writeFileSync } from 'node:fs';
import { runJob } from './aeroguard.mjs';
export const client=new Client({host:process.env.EVE_URL});
export async function answer(input,journal,deadline) {
 if(typeof input!=='string'||!input.trim()||input.length>16000) throw new Error('Input must contain 1 to 16000 characters');
 // AeroGuard: the engine (signed data + contract) decides; the LLM only polishes wording when enabled.
 const facts=await runJob(input,journal.split('/').pop().replace(/(-session)?\.json$/,''));
 if(process.env.AEROGUARD_LLM_POLISH!=='true'){writeFileSync(journal,JSON.stringify({phase:'answered',result:facts}),{mode:0o600});return facts;}
 const {session}=await client.sessions.create();
 writeFileSync(journal,JSON.stringify({sessionId:session.state.sessionId,phase:'sending'}),{mode:0o600});
 if(deadline!==undefined&&Date.now()>=deadline)throw new Error('Result deadline expired before model send');
 const result=await (await session.send(`Task: ${input}\n\nVerified facts (keep numbers, links and JSON unchanged):\n${facts}`)).result();
 if(result.status==='failed'||result.inputRequests.length||!result.message?.trim()) throw new Error('Turn did not return a final answer');
 writeFileSync(journal,JSON.stringify({sessionId:session.state.sessionId,phase:'answered',result:result.message}),{mode:0o600});
 return result.message;
}
