/** The hosted demo can run only on this isolated Vercel preview branch. */
export function isHostedReviewPreview(environment:string|undefined,branch:string|undefined){
 return environment==="preview"&&["review/london-management-adjustments","review/building-financial-statements"].includes(branch??"");
}
export function canViewSyntheticReview(nodeEnv:string|undefined,enabled:string|undefined,environment?:string,branch?:string){
 return (nodeEnv==="development"&&enabled==="1")||isHostedReviewPreview(environment,branch);
}
/** Applies only inside the synthetic deployment; never grants production access. */
export function syntheticPreviewRequest(method:string,pathname:string):"allow"|"block"|"redirect"{
 if(!["GET","HEAD"].includes(method)||pathname.startsWith("/api/")||pathname==="/api")return "block";
 if(pathname==="/"||pathname==="/review"||pathname.startsWith("/_next/")||pathname.startsWith("/aviaf-")||pathname==="/favicon.svg")return "allow";
 return "redirect";
}
