/** All money is stored as integer paise to avoid floating-point drift. */
export type Paise = number;

export type CaptureMode = 'voice' | 'ocr' | 'text';
export type ExpenseStatus = 'resolved' | 'unresolved';

export interface Group {
  id: string;
  /** Unguessable capability token used in the invite URL. */
  slug: string;
  name: string;
  createdAt: number;
  updatedAt: number;
}

export interface Member {
  id: string;
  groupId: string;
  name: string;
  /** Extra names the parser should recognise (nicknames, how speech-to-text spells them). */
  aliases: string[];
  upiId: string | null;
  deviceId: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface Expense {
  id: string;
  groupId: string;
  rawInput: string;
  captureMode: CaptureMode;
  description: string;
  amount: Paise | null;
  paidBy: string | null;
  /** When true, the split covers every member at settlement time. */
  splitAll: boolean;
  splitMemberIds: string[];
  status: ExpenseStatus;
  /** Human-readable reasons this entry needs attention. */
  issues: string[];
  /** Small JPEG data URL of the receipt (OCR captures only). */
  receiptThumb: string | null;
  createdBy: string | null;
  createdAt: number;
  updatedAt: number;
  deletedAt: number | null;
}

/** A recorded settle-up transfer between two members. */
export interface Payment {
  id: string;
  groupId: string;
  fromId: string;
  toId: string;
  amount: Paise;
  createdAt: number;
  updatedAt: number;
  deletedAt: number | null;
}

export interface Room {
  group: Group;
  members: Member[];
  expenses: Expense[];
  payments: Payment[];
  /** The member who owns this device in this room. */
  meId: string;
}
