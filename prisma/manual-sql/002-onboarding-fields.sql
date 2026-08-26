-- Onboarding fields collected on the "Complete your onboarding" page shown
-- after a plan is selected. Name, email and country are already captured at
-- registration and are read-only on that page, so nothing changes for them.
--
-- All columns are nullable because the user row is created at registration,
-- before this page is ever shown - between those two points a valid user row
-- legitimately has no profession, usage or acceptance. `termsAcceptedAt IS NULL`
-- is exactly what "has not onboarded yet" means, and the auth middleware reads
-- it that way. The fields are enforced as required by the API, not the schema.

ALTER TABLE `users`
  -- Organization / Company Name (optional on the form)
  ADD COLUMN `organization` VARCHAR(191) NULL,
  -- Role / Profession (required; validated against the dropdown list)
  ADD COLUMN `profession` VARCHAR(191) NULL,
  -- Intended Usage (required; TEXT because it is a free-form textarea)
  ADD COLUMN `intendedUsage` TEXT NULL,
  -- When all three required acknowledgements were given
  ADD COLUMN `termsAcceptedAt` DATETIME(3) NULL,
  -- Which acknowledgements were given, with the exact wording shown at the time
  ADD COLUMN `acknowledgements` JSON NULL;
