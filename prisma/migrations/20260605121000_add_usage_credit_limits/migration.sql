ALTER TABLE `subscriptions`
  ADD COLUMN `usageCreditsPerMonth` DOUBLE NULL;

UPDATE `subscriptions`
SET
  `usageCreditsPerMonth` = CASE
    WHEN `queriesPerMonth` IS NULL THEN NULL
    ELSE `queriesPerMonth`
  END;
