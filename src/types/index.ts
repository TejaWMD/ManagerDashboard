export type UserRole = 'account_manager' | 'manager' | 'admin';

export type PageView = 'home' | 'complaints';

export interface UserAccount {
  id: string;
  name: string;
  email: string;
  password: string;
  role: UserRole;
  roleLabel: string;
  department: string;
  avatarInitials: string;
}

export type ComplaintStatus = 'Open' | 'In Progress' | 'Escalated' | 'Resolved';

export type ComplaintPriority = 'Low' | 'Medium' | 'High' | 'Critical';

export type ComplaintCategory =
  | 'Service Quality'
  | 'Billing & Invoice'
  | 'Delivery & SLA'
  | 'Technical Issue'
  | 'Account Support';

export interface Complaint {
  id: string;
  ticketNumber: string;
  clientName: string;
  subject: string;
  category: ComplaintCategory;
  priority: ComplaintPriority;
  status: ComplaintStatus;
  description: string;
  submittedByEmail: string;
  submittedByName: string;
  assignedManagerEmail: string;
  managerRemarks: string;
  createdAt: string;
  updatedAt: string;
}
