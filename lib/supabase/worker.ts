// Server routes only. Never import this factory into a client component.
import {createClient} from "@supabase/supabase-js";
export class WorkerConfigurationError extends Error {}
export function createWorkerClient(){
 const url=process.env.NEXT_PUBLIC_SUPABASE_URL,key=process.env.SUPABASE_SERVICE_ROLE_KEY;
 if(!url||!key)throw new WorkerConfigurationError("The background service connection is not configured.");
 return createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
}
