/** Status text describes the saved snapshot, never the unsaved import preview. */
type PreparationStatus={prepared:{rows:readonly unknown[]}|null};
export function financialSaveLabel(state:PreparationStatus):string{
 return state.prepared?.rows.length?"Save budget & prepared batch":"Save draft preparation";
}
export function financialSaveMessage(state:PreparationStatus,revision:number):string{
 return state.prepared?.rows.length
  ?`Budget and prepared batch saved (revision ${revision}). No ledger entries or emails were created.`
  :`Draft preparation saved (revision ${revision}). This draft has no prepared batch. Any budget details already applied to this preparation are saved. No ledger entries or emails were created.`;
}
