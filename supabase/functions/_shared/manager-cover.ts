/** Named reciprocal cover. A current manager role and unchanged home assignment are required. */
export function colleaguePortfolio(email:string|null|undefined,own:string|null|undefined):string|null{
 const key=email?.toLowerCase();
 if(key==='ramiro@aviaf.co.uk'&&own==='Ramiro Naidoo')return 'Jillian';
 if(key==='jillian@aviaf.co.uk'&&own==='Jillian')return 'Ramiro Naidoo';
 return null;
}
export function managerPortfolioMatches(email:string|null|undefined,own:string|null|undefined,target:string):boolean{
 return !!own?.trim()&&!!target.trim()&&(own===target||colleaguePortfolio(email,own)===target);
}
export function canManageBlock(member:{role:string;portfolio_manager:string|null;email?:string}|null,manager:string):boolean{
 return !!member&&(member.role==='owner'||member.role==='admin'||member.role==='manager'&&managerPortfolioMatches(member.email,member.portfolio_manager,manager));
}
