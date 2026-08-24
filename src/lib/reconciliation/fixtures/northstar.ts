import type { Invoice, Payment } from "../types";

const invoiceRows: Array<[string, string, string, string, number, string]> = [
  ["1001", "Atlas Office Design", "CUST-001", "2026-06-02", 125_000, "PO-4401"],
  ["1002", "Blue Canyon HVAC", "CUST-002", "2026-06-03", 87_550, "BC-778"],
  ["1003", "Cedar Ridge Dental", "CUST-003", "2026-06-04", 240_000, "CRD-JUN"],
  ["1004", "Desert Bloom Marketing LLC", "CUST-004", "2026-06-05", 150_000, "DBM-601"],
  ["1005", "Desert Bloom Marketing LLC", "CUST-004", "2026-06-12", 122_500, "DBM-602"],
  ["1006", "Desert Bloom Marketing LLC", "CUST-004", "2026-06-19", 200_000, "DBM-603"],
  ["1007", "Copper State Legal LLP", "CUST-005", "2026-06-08", 500_000, "CSL-220"],
  ["1008", "Red Mesa Logistics Inc", "CUST-006", "2026-06-09", 360_000, "RML-914"],
  ["1009", "Suncrest Architecture PLLC", "CUST-007", "2026-06-10", 500_000, "SA-118"],
  ["1010", "Harborlight Consulting LLC", "CUST-008", "2026-06-11", 1_000_000, "HC-2026-4"],
  ["1011", "Juniper Data Systems", "CUST-009", "2026-06-13", 75_000, "JDS-77"],
  ["1012", "Summit Field Services", "CUST-010", "2026-06-14", 187_500, "SFS-332"],
  ["1013", "Willow Creek Events", "CUST-011", "2026-06-15", 320_000, "WCE-SUMMER"],
  ["1014", "Horizon Print Works", "CUST-012", "2026-06-16", 64_000, "HPW-91"],
  ["1015", "Stonegate Advisory Group", "CUST-013", "2026-06-17", 225_000, "SAG-402"],
  ["1016", "North Rim Landscaping LLC", "CUST-014", "2026-06-18", 142_500, "NRL-614"],
  ["1017", "Mesa Verde Laboratories", "CUST-015", "2026-06-20", 680_000, "MVL-820"],
  ["1018", "Ocotillo Creative Studio", "CUST-016", "2026-06-21", 97_500, "OCS-144"],
  ["1019", "Sonoran Safety Partners", "CUST-017", "2026-06-22", 118_000, "SSP-55"],
  ["1020", "Pinnacle Fabrication Co", "CUST-018", "2026-06-23", 450_000, "PF-620"],
  ["1021", "Gray Fox Engineering", "CUST-019", "2026-06-24", 275_000, "GFE-24A"],
  ["1022", "Ironwood Training Center", "CUST-020", "2026-06-25", 89_000, "ITC-810"],
  ["1023", "Clearview Janitorial Services", "CUST-021", "2026-06-26", 130_000, "CJS-2026-6"],
  ["1024", "Canyon Trail Supply", "CUST-022", "2026-06-27", 210_000, "CTS-884"],
  ["1025", "Lakeview Research Group", "CUST-023", "2026-06-28", 335_000, "LRG-62"],
  ["1026", "Cobalt Mechanical Services", "CUST-024", "2026-06-29", 760_000, "CMS-719"],
  ["1027", "Evergreen Fleet Care", "CUST-025", "2026-06-30", 165_000, "EFC-300"],
  ["1028", "Silverline Telecom Partners", "CUST-026", "2026-07-01", 420_000, "STP-711"],
  ["1029", "Wildflower Staffing Solutions", "CUST-027", "2026-07-02", 195_000, "WSS-702"],
  ["1030", "Four Peaks Property Care", "CUST-028", "2026-07-03", 232_500, "FPPC-73"],
];

function addDays(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}

export const northstarInvoices: Invoice[] = invoiceRows.map(([number, customerName, customerId, invoiceDate, amount, reference]) => ({
  id: `northstar-invoice-${number}`,
  invoiceNumber: `NS-2026-${number}`,
  customerName,
  customerId,
  invoiceDate,
  dueDate: addDays(invoiceDate, 30),
  originalAmountMinor: amount,
  outstandingAmountMinor: amount,
  currency: "USD",
  status: "open",
  reference,
}));

const paymentRows: Array<[string, number, string, string, string]> = [
  ["2026-06-10", 125_000, "Atlas Office Design", "ACH ATLAS INV NS-2026-1001", "TXN-10001"],
  ["2026-06-11", 87_550, "Blue Canyon HVAC", "ONLINE PAYMENT NS20261002", "TXN-10002"],
  ["2026-06-12", 240_000, "Cedar Ridge Dental", "WIRE PAYMENT NS-2026-1003", "TXN-10003"],
  ["2026-06-28", 472_500, "Desert Bloom Marketing", "ACH ORIG DESERT BLOOM INV 1004 1005 1006", "TXN-10004"],
  ["2026-06-29", 250_000, "Copper State Legal", "PARTIAL PMT NS-2026-1007", "TXN-10005"],
  ["2026-06-30", 180_000, "Red Mesa Logistics", "PARTIAL NS20261008", "TXN-10006"],
  ["2026-07-01", 485_000, "Suncrest Architecture", "CARD SETTLEMENT NS-2026-1009 LESS PLATFORM FEE", "TXN-10007"],
  ["2026-06-20", 300_000, "Harborlight Consulting", "INSTALLMENT NS-2026-1010 1 OF 3", "TXN-10008"],
  ["2026-06-27", 300_000, "Harborlight Consulting", "INSTALLMENT NS-2026-1010 2 OF 3", "TXN-10009"],
  ["2026-07-05", 400_000, "Harborlight Consulting", "FINAL INSTALLMENT NS-2026-1010", "TXN-10010"],
  ["2026-06-18", 75_000, "Juniper Data Systems", "ACH NS-2026-1011", "TXN-10011"],
  ["2026-06-19", 187_500, "Summit Field Services", "INVOICE NS20261012", "TXN-10012"],
  ["2026-06-22", 320_000, "Willow Creek Events", "PAYMENT NS-2026-1013", "TXN-10013"],
  ["2026-06-23", 64_000, "Horizon Print Works", "ACH CREDIT NS20261014", "TXN-10014"],
  ["2026-06-24", 225_000, "Stonegate Advisory", "TRANSFER NS-2026-1015", "TXN-10015"],
  ["2026-06-25", 142_500, "North Rim Landscape", "ACH ORIG NORTH RIM NRL-614", "TXN-10016"],
  ["2026-07-06", 714_000, "Mesa Verde Labs", "WIRE NS-2026-1017 INCLUDING CREDIT", "TXN-10017"],
  ["2026-06-18", 75_000, "Juniper Data Systems", "ACH NS-2026-1011", "TXN-10011"],
  ["2026-07-07", 53_500, "Redwood Community Arts", "MEMBERSHIP DEPOSIT", "TXN-10019"],
  ["2026-07-08", 260_000, "Black Rock Catering", "EVENT SERVICES PAYMENT", "TXN-10020"],
  ["2026-07-09", 999_900, "Valley Equipment Leasing", "WIRE CREDIT NO REMITTANCE", "TXN-10021"],
  ["2026-06-27", 97_500, "Ocotillo Creative", "INVOICE NS-2026-1018", "TXN-10022"],
];

export const northstarPayments: Payment[] = paymentRows.map(([paymentDate, amountMinor, payerName, description, transactionId], index) => ({
  id: `northstar-payment-${String(index + 1).padStart(2, "0")}`,
  paymentDate,
  amountMinor,
  currency: "USD",
  payerName,
  description,
  transactionId,
  accountId: "OPERATING-001",
}));

export const northstarDemoFixture = {
  companyName: "Northstar Services",
  notice: "Northstar Services and all records in this fixture are fictional.",
  invoices: northstarInvoices,
  payments: northstarPayments,
} as const;
