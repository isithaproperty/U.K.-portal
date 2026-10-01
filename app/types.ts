import type {ChargeDocumentSettings} from "../lib/service-charge-document";
export type Block = {
  documentSettings?: ChargeDocumentSettings;
  id: number;
  name: string;
  managementCompany: string;
  type: string;
  address: string;
  units: number;
  manager: string;
  financialYearEnd: string;
  myBlockManExportEnabled: boolean;
};

export type Unit = { paymentReference: string | null; id: number; blockId: number; unitNumber: string };
export type Resident = { archivedAt?:string|null; id: number; unitId: number; blockId: number; fullName: string; email: string; phone: string | null };

export type Contractor = { id:number; companyName:string; contactName:string|null; email:string|null; phone:string|null; trade:string; companyRegistration:string|null; vatNumber:string|null; status:"Pending"|"Approved"|"Suspended"; expiryPauseReason:string; notes:string; createdAt:string; updatedAt:string };
export type ContractorDocument = { id:number; contractorId:number; documentType:string; fileName:string; storagePath:string; mimeType:string|null; fileSize:number|null; expiryDate:string|null; notes:string; uploadedAt:string };
export type WorkOrder = { id:number; workOrderNumber:string; blockId:number; unitId:number|null; residentId:number|null; contractorId:number|null; title:string; description:string; category:string; priority:string; status:string; contractor:string|null; estimatedCost:number|null; actualCost:number|null; notes:string; addressSnapshot:string; paymentStatus:"Not approved"|"Approved"|"Paid"; paymentApprovedBy:string|null; paymentApprovedAt:string|null; paidAt:string|null; createdBy:string; createdAt:string; updatedAt:string };

export type BuildingSafetyRecord = { id:number; blockId:number; category:string; title:string; status:"Current"|"Action required"|"Expired"|"Under review"; dueDate:string|null; notes:string; fileName:string|null; storagePath:string|null; createdBy:string; createdAt:string; updatedAt:string };
