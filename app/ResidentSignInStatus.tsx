import {residentSignInLabel,type ResidentSignIn} from '../lib/resident-sign-in';
export default function ResidentSignInStatus({info}:{info?:ResidentSignIn}){
 return <span className="resident-sign-in" title="Account authentication, which may include recovery. This does not show portal visits or session refresh."><small>Last account sign-in (may include recovery)</small><br/>{info?.state==='signed_in'&&info.lastSignInAt?<time dateTime={info.lastSignInAt}>{residentSignInLabel(info)}</time>:<span>{residentSignInLabel(info)}</span>}</span>;
}
