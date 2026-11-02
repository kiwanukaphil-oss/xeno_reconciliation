-- Indexes for the Account Profiles directory (search, filter, sort and paged export over ~100k accounts).
--
-- NOTE: indexes on account_profile_aum are dropped whenever that materialized view is rebuilt
-- (DROP + CREATE). Any future migration that recreates the view must recreate these as well.

CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Substring search on client names ("%nakato%"), served by ILIKE through the trigram index
CREATE INDEX IF NOT EXISTS clients_client_name_trgm_idx ON clients USING gin ("clientName" gin_trgm_ops);

-- A name match jumps from clients to their accounts
CREATE INDEX IF NOT EXISTS account_profile_aum_client_id_idx ON account_profile_aum (client_id);

-- Account number prefix search ("701-55%")
CREATE INDEX IF NOT EXISTS account_profile_aum_account_number_pattern_idx ON account_profile_aum (account_number text_pattern_ops);

-- Default sort (largest balance first) with a unique tie-breaker, so paging and keyset export are stable
CREATE INDEX IF NOT EXISTS account_profile_aum_aum_account_idx ON account_profile_aum (aum DESC, account_id DESC);
-- CANDIDATE FOR REMOVAL: account_profile_aum_aum_idx (aum DESC) is now covered by the index above.
-- Left in place for now; drop it once the directory has run in production for a while.
