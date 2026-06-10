ALTER TABLE `subscriptions`
  ADD COLUMN `queriesPerMonth` INTEGER NULL,
  ADD COLUMN `queriesUsedThisMonth` INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN `monthResetDate` DATETIME(3) NULL;

UPDATE `subscriptions`
SET
  `queriesPerMonth` = CASE
    WHEN `planType` = 'Free' THEN 5
    WHEN `planType` = 'Farmers' THEN 50
    WHEN `planType` = 'Government' THEN 200
    WHEN `planType` = 'NGOs' THEN 400
    WHEN `planType` = 'Agribusinesses' THEN 800
    WHEN `planType` = 'Integrated' THEN NULL
    ELSE `queriesPerMonth`
  END,
  `queriesUsedThisMonth` = 0,
  `monthResetDate` = DATE_ADD(LAST_DAY(CURDATE()), INTERVAL 1 DAY);
