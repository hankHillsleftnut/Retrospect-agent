-- 141: each person can turn ambient off (founder's requirement, 20 Oct).
-- On by default; off means only what they send is read. The founder's master
-- switch (AMBIENT_MASTER=off on the agent) overrides it for everyone.
ALTER TABLE users ADD COLUMN IF NOT EXISTS ambient_enabled BOOLEAN NOT NULL DEFAULT TRUE;
