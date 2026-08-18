export interface Vehicle {
  id: string;
  customerId: string;
  customerName: string | null;
  name: string | null;
  make: string | null;
  model: string | null;
  year: number | null;
  registrationNumber: string | null;
  vin: string | null;
  mileage: number | null;
  notes: string | null;
  status: boolean;
  createdAt: string;
  updatedAt: string;
}
