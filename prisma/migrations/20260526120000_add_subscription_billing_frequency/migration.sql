ALTER TABLE `subscriptions`
  ADD COLUMN `billingFrequency` VARCHAR(191) NOT NULL DEFAULT 'monthly';
