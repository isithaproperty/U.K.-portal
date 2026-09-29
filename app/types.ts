export type Block = {
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

export type Unit = { id: number; blockId: number; unitNumber: string };
export type Resident = { id: number; unitId: number; blockId: number; fullName: string; email: string; phone: string | null };

export type WorkOrder = { id:number; blockId:number; title:string; description:string; priority:string; status:string; addressSnapshot:string; createdBy:string; createdAt:string };
