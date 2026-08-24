-- Record reviewer-selected invoice allocations exactly. The legacy decision RPC
-- inferred a greedy split from invoice order, so it is no longer callable by
-- authenticated clients after this migration.

create or replace function public.record_reconciliation_decision_v2(
  p_workspace_id uuid,
  p_run_record_id uuid,
  p_client_match_id text,
  p_outcome text,
  p_invoice_allocations jsonb,
  p_applied_amount_minor bigint,
  p_note text,
  p_fee_minor bigint,
  p_feedback text,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_organization_id uuid;
  v_run public.reconciliation_runs%rowtype;
  v_match public.matches%rowtype;
  v_existing_action public.reconciliation_actions%rowtype;
  v_invoice public.invoices%rowtype;
  v_payment public.payments%rowtype;
  v_allocation_item record;
  v_numeric_amount numeric;
  v_object_key_count integer;
  v_invoice_count integer;
  v_index integer;
  v_selected_invoice_ids uuid[] := '{}'::uuid[];
  v_selected_invoice_client_ids text[] := '{}'::text[];
  v_selected_invoice_amounts bigint[] := '{}'::bigint[];
  v_client_invoice_id text;
  v_total_payment_available bigint := 0;
  v_target_application bigint := 0;
  v_remaining_application bigint := 0;
  v_allocation bigint := 0;
  v_sequence integer := 0;
  v_invoice_balances jsonb := '{}'::jsonb;
  v_source_imports jsonb := '[]'::jsonb;
  v_payment_links jsonb := '[]'::jsonb;
  v_proposed_invoice_links jsonb := '[]'::jsonb;
  v_match_evidence jsonb := '[]'::jsonb;
  v_invoice_applications jsonb := '[]'::jsonb;
  v_payment_applications jsonb := '[]'::jsonb;
  v_canonical_invoice_allocations jsonb := '[]'::jsonb;
  v_previous_state jsonb;
  v_new_state jsonb;
  v_decision jsonb;
  v_action_type text;
  v_action_id uuid;
  v_decided_at timestamptz := now();
begin
  if v_actor is null or auth.role() <> 'authenticated' then
    raise exception using errcode = '42501', message = 'Authentication is required';
  end if;
  if not app_private.can_edit_workspace(p_workspace_id) then
    raise exception using errcode = '42501', message = 'Workspace edit access is required';
  end if;
  if p_outcome is null
     or p_outcome not in ('confirmed', 'rejected', 'unmatched')
     or nullif(btrim(p_client_match_id), '') is null
     or char_length(p_client_match_id) > 1000
     or nullif(btrim(p_idempotency_key), '') is null
     or char_length(p_idempotency_key) > 200
     or char_length(coalesce(p_note, '')) > 2000
     or coalesce(p_fee_minor, 0) < 0
     or coalesce(p_fee_minor, 0) > 9007199254740991
     or p_applied_amount_minor is null
     or p_applied_amount_minor < 0
     or p_applied_amount_minor > 9007199254740991
     or (p_feedback is not null and p_feedback not in ('correct', 'incorrect')) then
    raise exception using errcode = '22023', message = 'The reconciliation decision is invalid';
  end if;
  if p_invoice_allocations is null or jsonb_typeof(p_invoice_allocations) <> 'array' then
    raise exception using errcode = '22023', message = 'Invoice allocations must be an array';
  end if;
  if jsonb_array_length(p_invoice_allocations) > 100 then
    raise exception using errcode = '22023', message = 'A decision can allocate to at most 100 invoices';
  end if;
  if p_outcome = 'confirmed'
     and (jsonb_array_length(p_invoice_allocations) = 0 or p_applied_amount_minor <= 0) then
    raise exception using errcode = '22023', message = 'A confirmed decision requires a positive invoice allocation';
  end if;
  if p_outcome <> 'confirmed'
     and (jsonb_array_length(p_invoice_allocations) <> 0 or p_applied_amount_minor <> 0) then
    raise exception using errcode = '22023', message = 'Only confirmed decisions can allocate invoice amounts';
  end if;

  select w.organization_id into v_organization_id
  from public.workspaces w
  where w.id = p_workspace_id;
  if v_organization_id is null then
    raise exception using errcode = '42501', message = 'Workspace access is required';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_workspace_id::text || ':decision:' || p_idempotency_key, 0)
  );
  select a.* into v_existing_action
  from public.reconciliation_actions a
  where a.workspace_id = p_workspace_id
    and a.idempotency_key = p_idempotency_key;
  if found then
    return jsonb_build_object(
      'action_id', v_existing_action.id,
      'decision', v_existing_action.new_state -> 'decision',
      'invoice_balances', coalesce(v_existing_action.new_state -> 'invoiceBalances', '{}'::jsonb),
      'existing', true
    );
  end if;

  select r.* into v_run
  from public.reconciliation_runs r
  where r.id = p_run_record_id
    and r.workspace_id = p_workspace_id
    and r.status = 'completed';
  if not found then
    raise exception using errcode = '42501', message = 'The reconciliation run is not available in this workspace';
  end if;

  select m.* into v_match
  from public.matches m
  where m.workspace_id = p_workspace_id
    and m.reconciliation_run_id = p_run_record_id
    and m.client_match_id = p_client_match_id
  for update;
  if not found then
    raise exception using errcode = '42501', message = 'The reconciliation match is not available in this run';
  end if;
  if v_match.status <> 'suggested' then
    raise exception using errcode = '55000', message = 'This reconciliation match already has a decision';
  end if;

  perform 1
  from public.payments p
  join public.match_payment_links pl
    on pl.payment_id = p.id and pl.workspace_id = p.workspace_id
  where pl.workspace_id = p_workspace_id and pl.match_id = v_match.id
  order by p.id
  for update of p;

  if exists (
    select 1
    from public.payments p
    join public.match_payment_links pl
      on pl.payment_id = p.id and pl.workspace_id = p.workspace_id
    where pl.workspace_id = p_workspace_id
      and pl.match_id = v_match.id
      and p.currency_code <> v_match.currency_code
  ) then
    raise exception using errcode = '22023', message = 'Every linked payment must use the match currency';
  end if;

  select coalesce(sum(p.unapplied_amount_minor), 0) into v_total_payment_available
  from public.payments p
  join public.match_payment_links pl
    on pl.payment_id = p.id and pl.workspace_id = p.workspace_id
  where pl.workspace_id = p_workspace_id and pl.match_id = v_match.id;

  select jsonb_build_array(
    jsonb_build_object(
      'id', ii.id,
      'type', ii.import_type,
      'filename', ii.original_filename,
      'accepted_rows', ii.accepted_rows,
      'rejected_rows', ii.rejected_rows
    ),
    jsonb_build_object(
      'id', pi.id,
      'type', pi.import_type,
      'filename', pi.original_filename,
      'accepted_rows', pi.accepted_rows,
      'rejected_rows', pi.rejected_rows
    )
  ) into v_source_imports
  from public.imports ii
  cross join public.imports pi
  where ii.id = v_run.invoice_import_id and ii.workspace_id = p_workspace_id
    and pi.id = v_run.payment_import_id and pi.workspace_id = p_workspace_id;

  select coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
    'paymentId', coalesce(nullif(p.raw_source ->> 'client_id', ''), p.id::text),
    'recordId', p.id,
    'amountMinor', p.amount_minor,
    'unappliedAmountMinorBefore', p.unapplied_amount_minor,
    'currency', p.currency_code,
    'transactionId', nullif(p.raw_source ->> 'transaction_id', ''),
    'bankReference', p.bank_reference,
    'sourceImportId', p.import_id
  )) order by pl.sequence_number), '[]'::jsonb)
  into v_payment_links
  from public.match_payment_links pl
  join public.payments p on p.id = pl.payment_id and p.workspace_id = pl.workspace_id
  where pl.workspace_id = p_workspace_id and pl.match_id = v_match.id;

  select coalesce(jsonb_agg(jsonb_build_object(
    'invoiceId', coalesce(nullif(i.raw_source ->> 'client_id', ''), i.id::text),
    'recordId', i.id,
    'invoiceNumber', i.invoice_number,
    'proposedAmountMinor', l.applied_amount_minor,
    'outstandingAmountMinorBefore', i.outstanding_balance_minor
  ) order by l.sequence_number), '[]'::jsonb)
  into v_proposed_invoice_links
  from public.match_invoice_links l
  join public.invoices i on i.id = l.invoice_id and i.workspace_id = l.workspace_id
  where l.workspace_id = p_workspace_id and l.match_id = v_match.id;

  select coalesce(jsonb_agg(jsonb_build_object(
    'code', e.reason_code,
    'strength', e.strength,
    'message', e.explanation_text,
    'evidence', e.evidence
  ) order by e.display_order), '[]'::jsonb)
  into v_match_evidence
  from public.match_explanations e
  where e.workspace_id = p_workspace_id and e.match_id = v_match.id;

  v_previous_state := jsonb_build_object(
    'matchStatus', v_match.status,
    'matchingMethod', v_match.matching_method,
    'confidence', v_match.confidence_category,
    'proposedApplicationMinor', v_match.proposed_application_minor,
    'discrepancyMinor', v_match.discrepancy_minor,
    'paymentLinks', v_payment_links,
    'invoiceLinks', v_proposed_invoice_links,
    'evidence', v_match_evidence
  );

  if p_outcome = 'confirmed' then
    for v_allocation_item in
      select value, ordinality::integer as sequence_number
      from jsonb_array_elements(p_invoice_allocations) with ordinality
      order by ordinality
    loop
      if jsonb_typeof(v_allocation_item.value) <> 'object' then
        raise exception using errcode = '22023', message = 'Every invoice allocation must be an object';
      end if;
      select count(*) into v_object_key_count
      from jsonb_object_keys(v_allocation_item.value);
      if v_object_key_count <> 2
         or not (v_allocation_item.value ? 'invoiceId')
         or not (v_allocation_item.value ? 'amountMinor')
         or jsonb_typeof(v_allocation_item.value -> 'invoiceId') <> 'string'
         or jsonb_typeof(v_allocation_item.value -> 'amountMinor') <> 'number' then
        raise exception using errcode = '22023', message = 'Every allocation requires only an invoiceId and integer amountMinor';
      end if;

      v_client_invoice_id := btrim(v_allocation_item.value ->> 'invoiceId');
      v_numeric_amount := (v_allocation_item.value ->> 'amountMinor')::numeric;
      if nullif(v_client_invoice_id, '') is null
         or char_length(v_client_invoice_id) > 1000
         or v_client_invoice_id = any(v_selected_invoice_client_ids)
         or v_numeric_amount <> trunc(v_numeric_amount)
         or v_numeric_amount <= 0
         or v_numeric_amount > 9007199254740991 then
        raise exception using errcode = '22023', message = 'Invoice allocations require unique invoice IDs and positive integer minor amounts';
      end if;
      v_selected_invoice_client_ids := array_append(v_selected_invoice_client_ids, v_client_invoice_id);
      v_selected_invoice_amounts := array_append(v_selected_invoice_amounts, v_numeric_amount::bigint);
      v_canonical_invoice_allocations := v_canonical_invoice_allocations || jsonb_build_array(jsonb_build_object(
        'invoiceId', v_client_invoice_id,
        'amountMinor', v_numeric_amount::bigint
      ));
      if v_target_application > 9007199254740991 - v_numeric_amount::bigint then
        raise exception using errcode = '22023', message = 'The invoice allocation total is too large';
      end if;
      v_target_application := v_target_application + v_numeric_amount::bigint;
    end loop;

    if v_target_application <> p_applied_amount_minor then
      raise exception using errcode = '22023', message = 'The applied total must equal the invoice allocation total';
    end if;

    perform 1
    from public.invoices i
    where i.workspace_id = p_workspace_id
      and i.import_id = v_run.invoice_import_id
      and i.raw_source ->> 'client_id' = any(v_selected_invoice_client_ids)
    order by i.id
    for update;

    for v_index in 1..array_length(v_selected_invoice_client_ids, 1) loop
      v_client_invoice_id := v_selected_invoice_client_ids[v_index];
      select count(*) into v_invoice_count
      from public.invoices i
      where i.workspace_id = p_workspace_id
        and i.import_id = v_run.invoice_import_id
        and i.raw_source ->> 'client_id' = v_client_invoice_id;
      if v_invoice_count <> 1 then
        raise exception using errcode = '22023', message = 'A selected invoice is unavailable or ambiguous';
      end if;

      select i.* into v_invoice
      from public.invoices i
      where i.workspace_id = p_workspace_id
        and i.import_id = v_run.invoice_import_id
        and i.raw_source ->> 'client_id' = v_client_invoice_id;
      if v_invoice.status not in ('open', 'partially_paid')
         or v_invoice.currency_code <> v_match.currency_code then
        raise exception using errcode = '22023', message = 'A selected invoice is unavailable, paid, or uses another currency';
      end if;
      if v_selected_invoice_amounts[v_index] > v_invoice.outstanding_balance_minor then
        raise exception using errcode = '22023', message = 'An invoice allocation exceeds its outstanding balance';
      end if;
      v_selected_invoice_ids := array_append(v_selected_invoice_ids, v_invoice.id);
    end loop;

    if v_target_application > v_total_payment_available then
      raise exception using errcode = '22023', message = 'The invoice allocations exceed the available payment amount';
    end if;
    if coalesce(p_fee_minor, 0) > v_match.payment_amount_minor then
      raise exception using errcode = '22023', message = 'The fee cannot exceed the payment amount';
    end if;

    delete from public.match_invoice_links l
    where l.workspace_id = p_workspace_id and l.match_id = v_match.id;
    for v_index in 1..array_length(v_selected_invoice_ids, 1) loop
      v_sequence := v_index;
      v_allocation := v_selected_invoice_amounts[v_index];
      update public.invoices i set
        outstanding_balance_minor = i.outstanding_balance_minor - v_allocation,
        status = case
          when i.outstanding_balance_minor - v_allocation = 0 then 'paid'
          when i.outstanding_balance_minor - v_allocation < i.original_amount_minor then 'partially_paid'
          else 'open'
        end
      where i.id = v_selected_invoice_ids[v_index]
        and i.workspace_id = p_workspace_id
        and i.outstanding_balance_minor >= v_allocation
      returning * into v_invoice;
      if not found then
        raise exception using errcode = '55000', message = 'An invoice balance changed before the allocation was applied';
      end if;
      insert into public.match_invoice_links (
        workspace_id, match_id, invoice_id, applied_amount_minor, sequence_number
      ) values (
        p_workspace_id, v_match.id, v_invoice.id, v_allocation, v_sequence
      );
      v_invoice_balances := v_invoice_balances || jsonb_build_object(
        v_selected_invoice_client_ids[v_index], v_invoice.outstanding_balance_minor
      );
      v_invoice_applications := v_invoice_applications || jsonb_build_array(jsonb_build_object(
        'invoiceId', v_selected_invoice_client_ids[v_index],
        'recordId', v_invoice.id,
        'invoiceNumber', v_invoice.invoice_number,
        'appliedAmountMinor', v_allocation,
        'resultingOutstandingAmountMinor', v_invoice.outstanding_balance_minor
      ));
    end loop;

    v_remaining_application := v_target_application;
    for v_payment in
      select p.*
      from public.payments p
      join public.match_payment_links pl
        on pl.payment_id = p.id and pl.workspace_id = p.workspace_id
      where pl.workspace_id = p_workspace_id and pl.match_id = v_match.id
      order by pl.sequence_number
      for update of p
    loop
      exit when v_remaining_application <= 0;
      v_allocation := least(v_remaining_application, v_payment.unapplied_amount_minor);
      if v_allocation <= 0 then
        continue;
      end if;
      update public.payments p set
        unapplied_amount_minor = p.unapplied_amount_minor - v_allocation,
        status = case
          when p.unapplied_amount_minor - v_allocation = 0 then 'reconciled'
          when p.unapplied_amount_minor - v_allocation < p.amount_minor then 'partially_applied'
          else 'unmatched'
        end
      where p.id = v_payment.id and p.workspace_id = p_workspace_id
      returning p.* into v_payment;
      v_payment_applications := v_payment_applications || jsonb_build_array(jsonb_strip_nulls(jsonb_build_object(
        'paymentId', coalesce(nullif(v_payment.raw_source ->> 'client_id', ''), v_payment.id::text),
        'recordId', v_payment.id,
        'appliedAmountMinor', v_allocation,
        'resultingUnappliedAmountMinor', v_payment.unapplied_amount_minor,
        'sourceImportId', v_payment.import_id
      )));
      v_remaining_application := v_remaining_application - v_allocation;
    end loop;
    if v_remaining_application <> 0 then
      raise exception using errcode = '55000', message = 'The available payment amount changed before the allocation was applied';
    end if;

    update public.matches m set
      status = 'approved', proposed_application_minor = v_target_application,
      requires_review = false, resolved_at = v_decided_at, resolved_by = v_actor
    where m.id = v_match.id and m.workspace_id = p_workspace_id;
    v_action_type := 'approve';
  else
    update public.matches m set
      status = 'rejected', resolved_at = v_decided_at, resolved_by = v_actor
    where m.id = v_match.id and m.workspace_id = p_workspace_id;
    update public.payments p set status = case
      when p.unapplied_amount_minor = 0 then 'reconciled'
      when p.unapplied_amount_minor < p.amount_minor then 'partially_applied'
      else 'unmatched'
    end
    where p.workspace_id = p_workspace_id
      and p.id in (
        select pl.payment_id from public.match_payment_links pl
        where pl.workspace_id = p_workspace_id and pl.match_id = v_match.id
      );
    v_action_type := case when p_outcome = 'rejected' then 'reject' else 'leave_unmatched' end;
  end if;

  v_decision := jsonb_strip_nulls(jsonb_build_object(
    'matchId', p_client_match_id,
    'outcome', p_outcome,
    'invoiceIds', case when p_outcome = 'confirmed' then to_jsonb(v_selected_invoice_client_ids) else '[]'::jsonb end,
    'allocations', case when p_outcome = 'confirmed' then v_canonical_invoice_allocations else '[]'::jsonb end,
    'note', nullif(btrim(coalesce(p_note, '')), ''),
    'feeMinor', case when coalesce(p_fee_minor, 0) > 0 then p_fee_minor else null end,
    'appliedAmountMinor', case when p_outcome = 'confirmed' then v_target_application else 0 end,
    'feedback', p_feedback,
    'decidedAt', v_decided_at
  ));
  v_new_state := jsonb_build_object(
    'decision', v_decision,
    'invoiceBalances', v_invoice_balances,
    'appliedAmountMinor', v_target_application,
    'invoiceApplications', v_invoice_applications,
    'paymentApplications', v_payment_applications,
    'paymentLinks', v_payment_links,
    'sourceImports', v_source_imports,
    'automatedProposal', jsonb_build_object(
      'matchingMethod', v_match.matching_method,
      'confidence', v_match.confidence_category,
      'proposedApplicationMinor', v_match.proposed_application_minor,
      'discrepancyMinor', v_match.discrepancy_minor,
      'invoiceLinks', v_proposed_invoice_links,
      'evidence', v_match_evidence
    )
  );

  insert into public.reconciliation_actions (
    workspace_id, reconciliation_run_id, match_id, payment_id, actor_user_id, action_type,
    decision_note, previous_state, new_state, idempotency_key
  ) values (
    p_workspace_id, p_run_record_id, v_match.id, v_match.payment_id, v_actor, v_action_type,
    nullif(btrim(coalesce(p_note, '')), ''), v_previous_state, v_new_state,
    p_idempotency_key
  ) returning id into v_action_id;

  insert into public.audit_events (
    organization_id, workspace_id, actor_user_id, event_type, entity_type,
    entity_id, source_import_id, metadata
  ) values (
    v_organization_id, p_workspace_id, v_actor,
    'reconciliation_match.' || p_outcome, 'match', v_match.id, v_run.payment_import_id,
    jsonb_build_object(
      'action_id', v_action_id,
      'reconciliation_run_id', p_run_record_id,
      'client_match_id', p_client_match_id,
      'invoice_count', case when p_outcome = 'confirmed' then cardinality(v_selected_invoice_client_ids) else 0 end,
      'invoice_ids', case when p_outcome = 'confirmed' then to_jsonb(v_selected_invoice_client_ids) else '[]'::jsonb end,
      'invoice_allocations', case when p_outcome = 'confirmed' then v_canonical_invoice_allocations else '[]'::jsonb end,
      'applied_amount_minor', case when p_outcome = 'confirmed' then v_target_application else 0 end,
      'currency_code', v_match.currency_code,
      'matching_method', v_match.matching_method,
      'confidence', v_match.confidence_category,
      'payment_links', v_payment_links,
      'proposed_invoice_links', v_proposed_invoice_links,
      'match_evidence', v_match_evidence,
      'source_imports', v_source_imports,
      'has_note', nullif(btrim(coalesce(p_note, '')), '') is not null,
      'feedback', p_feedback
    )
  );

  if p_outcome = 'confirmed' then
    insert into public.usage_records (
      organization_id, workspace_id, metric_code, period_start, period_end,
      quantity, source_event_id
    ) values (
      v_organization_id, p_workspace_id, 'matches_confirmed', current_date, current_date,
      1, 'reconciliation-action:' || v_action_id::text
    );
  end if;

  return jsonb_build_object(
    'action_id', v_action_id,
    'decision', v_decision,
    'invoice_balances', v_invoice_balances,
    'existing', false
  );
end;
$$;

revoke execute on function public.record_reconciliation_decision(
  uuid, uuid, text, text, text[], text, bigint, text, text
) from authenticated;

revoke all on function public.record_reconciliation_decision_v2(
  uuid, uuid, text, text, jsonb, bigint, text, bigint, text, text
) from public, anon, authenticated;

grant execute on function public.record_reconciliation_decision_v2(
  uuid, uuid, text, text, jsonb, bigint, text, bigint, text, text
) to authenticated;

comment on function public.record_reconciliation_decision_v2(
  uuid, uuid, text, text, jsonb, bigint, text, bigint, text, text
) is 'Atomically records an explicit per-invoice reconciliation allocation and its audit trail.';
