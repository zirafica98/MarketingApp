export type Role = 'owner' | 'admin' | 'editor' | 'approver' | 'viewer';

export const ROLE_LABEL: Record<Role, string> = {
  owner: 'Vlasnik',
  admin: 'Admin',
  editor: 'Urednik',
  approver: 'Odobrava',
  viewer: 'Posmatrač',
};

export const ROLE_OPIS: Record<Role, string> = {
  owner: 'sve, uključujući naplatu i brisanje',
  admin: 'brendovi, konektori i članovi',
  editor: 'pravi i menja nacrte i strategiju',
  approver: 'odobrava, odbija i zakazuje objave',
  viewer: 'samo čita kalendar i statistiku',
};

export interface Workspace {
  id: string;
  name: string;
  plan: string;
  role: Role;
  brand_ids: string[] | null;
}

export interface Brand {
  id: string;
  workspace_id: string;
  name: string;
  website: string | null;
  instagram_handle: string | null;
  language: string;
  timezone: string;
  color: string;
  created_at: string;
}

export interface Member {
  user_id: string;
  role: Role;
  brand_ids: string[] | null;
  created_at: string;
  profile: { full_name: string; email: string } | null;
}

export interface Invitation {
  id: string;
  email: string;
  role: Role;
  brand_ids: string[] | null;
  token: string;
  created_at: string;
  expires_at: string;
  accepted_at: string | null;
}

export type JobStatus = 'queued' | 'running' | 'done' | 'failed' | 'canceled';

export interface Job {
  id: string;
  brand_id: string | null;
  type: string;
  payload?: Record<string, unknown>;
  status: JobStatus;
  result: unknown;
  error: string | null;
  attempts: number;
  created_at: string;
  finished_at: string | null;
}
