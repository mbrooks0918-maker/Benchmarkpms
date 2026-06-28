-- Reliable, server-side acceptance of an org invite.
--
-- WHY: a brand-new invited user is not yet a member of the org, so an RLS
-- INSERT policy on org_members that requires existing membership/ownership
-- would block them from inserting their own membership row. This SECURITY
-- DEFINER function creates the membership safely, server-side, after validating
-- the invite token against the signed-in user's email. It is idempotent, so the
-- client can safely call it more than once (and retry on transient failures).
--
-- Apply this in the Supabase SQL editor for the COMMERCIAL project
-- (ukrqgzpsoytafxafsoek). Review the org_members unique constraint referenced by
-- the ON CONFLICT clause below and adjust it to match your schema if needed.
--
-- NOTE: keeps the existing function name `accept_invite(p_token text)` so the
-- client (AcceptInvite.tsx + Dashboard.tsx) needs no change. Do NOT modify
-- handle_new_user.

create or replace function public.accept_invite(p_token text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_invite public.org_invites%rowtype;
  v_email  text;
begin
  -- Must be authenticated.
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  select email into v_email from auth.users where id = auth.uid();

  -- Find a still-open invite for this token.
  select * into v_invite
  from public.org_invites
  where token = p_token
    and accepted = false
  limit 1;

  -- No open invite: if the membership already exists, treat as success
  -- (idempotent); otherwise there is nothing to accept.
  if not found then
    return;
  end if;

  -- The invite must be addressed to the signed-in user.
  if lower(coalesce(v_invite.email, '')) <> lower(coalesce(v_email, '')) then
    raise exception 'This invite was issued to a different email address.';
  end if;

  -- Create the membership (idempotent). Requires a unique constraint on
  -- (org_id, user_id); adjust the conflict target if yours differs.
  insert into public.org_members (org_id, user_id, role)
  values (v_invite.org_id, auth.uid(), v_invite.role)
  on conflict (org_id, user_id) do nothing;

  -- Mark the invite consumed.
  update public.org_invites set accepted = true where id = v_invite.id;
end;
$$;

grant execute on function public.accept_invite(text) to authenticated;
