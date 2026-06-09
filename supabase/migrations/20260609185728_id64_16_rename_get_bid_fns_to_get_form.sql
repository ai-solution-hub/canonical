-- id64_16: rename get_bid_* RPCs to get_form_* — completes the {64.14} bid→form rename.
--
-- Mechanism: ALTER FUNCTION ... RENAME TO. This preserves BOTH the function body
-- AND its ACL: the ACL is bound to the function OID, so the ops43 REVOKE-from-PUBLIC
-- travels with the rename. No re-GRANT / re-REVOKE is required.
--
-- Scope: EXACTLY the three functions below (user-ratified). Domain-neutral names
-- (hybrid_search, get_aggregate_win_rate_stats, get_content_win_rate) are deliberately
-- NOT renamed.
--
-- PROD APPLY DEFERRED — ID-45 cutover (Liam-gated). This migration is applied to
-- STAGING only in this session; prod application is held for the ID-45 public cutover.
--
-- Confirmed identity signatures (pg_get_function_identity_arguments on staging,
-- each arity = 1, no overloads):
--   get_bid_question_stats(uuid)         -> get_form_question_stats(uuid)
--   get_bid_question_stats_batch(uuid[]) -> get_form_question_stats_batch(uuid[])
--   get_bid_summary(uuid)                -> get_form_summary(uuid)

ALTER FUNCTION public.get_bid_question_stats(uuid) RENAME TO get_form_question_stats;
ALTER FUNCTION public.get_bid_question_stats_batch(uuid[]) RENAME TO get_form_question_stats_batch;
ALTER FUNCTION public.get_bid_summary(uuid) RENAME TO get_form_summary;
