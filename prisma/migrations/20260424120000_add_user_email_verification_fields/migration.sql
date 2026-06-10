ALTER TABLE `users`
  ADD COLUMN `emailVerified` BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN `emailVerificationToken` VARCHAR(191) NULL,
  ADD COLUMN `emailVerificationExpires` DATETIME(3) NULL,
  ADD COLUMN `settings` JSON NOT NULL DEFAULT ('{"theme":"light","notifications":true,"chatHistoryEnabled":true,"language":"en","modelTemperature":0.7,"exportFormat":"json"}');

CREATE UNIQUE INDEX `users_emailVerificationToken_key` ON `users`(`emailVerificationToken`);
