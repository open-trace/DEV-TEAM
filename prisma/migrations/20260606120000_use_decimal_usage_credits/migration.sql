ALTER TABLE `subscriptions`
  MODIFY COLUMN `usageCreditsUsedThisMonth` DECIMAL(10, 4) NOT NULL DEFAULT 0,
  MODIFY COLUMN `usageCreditsPerMonth` DECIMAL(10, 4) NULL;

ALTER TABLE `usage_events`
  MODIFY COLUMN `usageCredits` DECIMAL(10, 4) NOT NULL;
