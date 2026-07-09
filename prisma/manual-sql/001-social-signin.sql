-- 1. Make password nullable (social accounts have no password)
ALTER TABLE `users` MODIFY `password` VARCHAR(191) NULL;

-- 2. Make country nullable (new social users set it after first sign-in)
ALTER TABLE `users` MODIFY `country` VARCHAR(191) NULL;

-- 3. Add provider column ("local" for all existing rows)
ALTER TABLE `users` ADD COLUMN `provider` VARCHAR(191) NOT NULL DEFAULT 'local';

-- 4. Add googleId column (nullable, unique) for linking Google accounts
ALTER TABLE `users` ADD COLUMN `googleId` VARCHAR(191) NULL;
ALTER TABLE `users` ADD UNIQUE INDEX `users_googleId_key` (`googleId`);

-- Note: existing email/password rows are unaffected - they keep their password
-- and country, and provider defaults to 'local'.
