import { createHash } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { AppError, databaseError } from './http';

export const signInSchema = z.object({
  email: z.string().trim().email().transform((value) => value.toLowerCase()),
  password: z.string().min(8).max(128),
}).strict();

const profileInputFields = {
  displayName: z.string().trim().min(1).max(40),
  gender: z.enum(['male', 'female', 'other', 'prefer_not_to_say']),
  birthday: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((value) => {
    const parsed = new Date(`${value}T00:00:00.000Z`);
    const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
    const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value ?? '';
    const localToday = `${part('year').padStart(4, '0')}-${part('month')}-${part('day')}`;
    return Number(value.slice(0, 4)) > 0 && !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value && value <= localToday;
  }),
  clownRole: z.enum(['clown_boy', 'clown_girl']).optional(),
};
function refineProfileRole(profile: { gender: string; clownRole?: string }, context: z.RefinementCtx) {
  if (['other', 'prefer_not_to_say'].includes(profile.gender) && !profile.clownRole) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['clownRole'], message: 'Choose a clown role.' });
  }
}

export const profileEditSchema = z.object({displayName:profileInputFields.displayName,gender:profileInputFields.gender,birthday:profileInputFields.birthday}).strict();

export const profileInitializationSchema = z.object(profileInputFields).strict().superRefine(refineProfileRole);

export const registerInviteSchema = z.object({
  email: z.string().trim().email().transform((value) => value.toLowerCase()),
  password: z.string().min(8).max(128),
  inviteToken: z.string().regex(/^[a-f0-9]{64}$/),
  ...profileInputFields,
}).strict().superRefine(refineProfileRole);

export type RegistrationProfile = z.infer<typeof profileInitializationSchema>;

export type AuthUser = { id: string; email: string };

export type AuthDeps = {
  rateLimit(keyHash: string): Promise<boolean>;
  inviteAllowed(tokenHash: string): Promise<boolean>;
  createConfirmedUser(email: string, password: string): Promise<AuthUser>;
  signIn(email: string, password: string): Promise<AuthUser>;
  initializeProfile(profile: RegistrationProfile): Promise<void>;
  acceptInvitation(token: string): Promise<string>;
  signOut(): Promise<void>;
};

const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');
const normalizeEmail = (value: string) => value.trim().toLowerCase();

function genericError(status: number, code: string, message: string) {
  return new AppError(status, code, message);
}

function isDuplicateAccount(error: unknown) {
  if (!error || typeof error !== 'object') return false;
  const candidate = error as { code?: unknown; message?: unknown };
  const code = typeof candidate.code === 'string' ? candidate.code.toLowerCase() : '';
  const message = typeof candidate.message === 'string' ? candidate.message.toLowerCase() : '';
  return code === 'email_exists' || code === 'user_already_exists' || message.includes('already registered') || message.includes('already exists');
}

export function createAuthDeps(admin: SupabaseClient, db: SupabaseClient): AuthDeps {
  return {
    async rateLimit(keyHash) {
      const { data, error } = await admin.rpc('duet_auth_rate', { p_key_hash: keyHash });
      if (error) databaseError(error);
      return data === true;
    },
    async inviteAllowed(tokenHash) {
      const { data, error } = await admin.rpc('duet_invite_registration_allowed', { p_invite_hash: tokenHash });
      if (error) databaseError(error);
      return data === true;
    },
    async createConfirmedUser(email, password) {
      const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
      if (error || !data.user?.id) throw error ?? new Error('missing created user');
      return { id: data.user.id, email: data.user.email ?? email };
    },
    async signIn(email, password) {
      const { data, error } = await db.auth.signInWithPassword({ email, password });
      if (error || !data.user?.id) throw error ?? new Error('missing signed-in user');
      return { id: data.user.id, email: data.user.email ?? email };
    },
    async initializeProfile(profile) {
      const { error } = await db.rpc('duet_initialize_profile', {
        p_display_name: profile.displayName,
        p_gender: profile.gender,
        p_birthday: profile.birthday,
        p_clown_role: profile.clownRole ?? null,
      });
      if (error) databaseError(error);
    },
    async acceptInvitation(token) {
      const { data, error } = await db.rpc('duet_accept_invitation', { p_token: token });
      if (error) databaseError(error);
      if (typeof data !== 'string') throw genericError(503, 'registration_unavailable', 'Unable to register. Please try again later.');
      return data;
    },
    async signOut() {
      const { error } = await db.auth.signOut({ scope: 'local' });
      if (error) throw genericError(503, 'sign_out_unavailable', 'Unable to sign out. Please try again.');
    },
  };
}

export async function signInWithPassword(deps: AuthDeps, input: { email: string; password: string }): Promise<AuthUser> {
  const email = normalizeEmail(input.email);
  if (!(await deps.rateLimit(sha256(`email:${email}`)))) {
    throw genericError(429, 'rate_limited', 'Too many requests. Please try again later.');
  }
  try {
    const user = await deps.signIn(email, input.password);
    return { id: user.id, email: normalizeEmail(user.email || email) };
  } catch {
    throw genericError(401, 'invalid_credentials', 'Incorrect email or password.');
  }
}

export async function registerWithInvite(
  deps: AuthDeps,
  input: z.infer<typeof registerInviteSchema>,
): Promise<{ id: string; email: string; coupleId: string }> {
  const email = normalizeEmail(input.email);
  const token = input.inviteToken;
  if (!(await deps.rateLimit(sha256(`email:${email}`))) || !(await deps.rateLimit(sha256(`invite:${token}`)))) {
    throw genericError(429, 'rate_limited', 'Too many requests. Please try again later.');
  }
  if (!(await deps.inviteAllowed(sha256(token)))) {
    throw genericError(410, 'invalid_invitation', 'This invitation has expired, has been used, or is unavailable.');
  }

  let created: AuthUser;
  try {
    created = await deps.createConfirmedUser(email, input.password);
  } catch (error) {
    if (error instanceof AppError) throw error;
    if (isDuplicateAccount(error)) {
      throw genericError(409, 'account_exists', 'Unable to register. Check your email or sign in with your existing account.');
    }
    throw genericError(503, 'registration_unavailable', 'Unable to register. Please try again later.');
  }

  let signedIn: AuthUser;
  try {
    signedIn = await deps.signIn(email, input.password);
  } catch {
    throw genericError(503, 'registration_unavailable', 'Unable to register. Please try again later.');
  }
  if (signedIn.id !== created.id) {
    await deps.signOut().catch(() => undefined);
    throw genericError(401, 'invalid_credentials', 'Incorrect email or password.');
  }

  try {
    await deps.initializeProfile({
      displayName: input.displayName,
      gender: input.gender,
      birthday: input.birthday,
      ...(input.clownRole ? { clownRole: input.clownRole } : {}),
    });
  } catch {
    await deps.signOut().catch(() => undefined);
    throw genericError(503, 'registration_unavailable', 'Unable to register. Please try again later.');
  }

  try {
    const coupleId = await deps.acceptInvitation(token);
    return { id: signedIn.id, email: normalizeEmail(signedIn.email || email), coupleId };
  } catch (error) {
    // Auth and Postgres cannot share one transaction. Keep the confirmed Auth account,
    // but clear its newly issued session if the invitation could not be consumed.
    await deps.signOut().catch(() => undefined);
    if (error instanceof AppError) throw error;
    throw genericError(503, 'registration_unavailable', 'Unable to register. Please try again later.');
  }
}
