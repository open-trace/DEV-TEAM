ALTER TABLE `subscriptions`
  ADD COLUMN `usageCreditsUsedThisMonth` DOUBLE NOT NULL DEFAULT 0;

CREATE TABLE `usage_events` (
  `id` VARCHAR(191) NOT NULL,
  `userId` VARCHAR(191) NOT NULL,
  `subscriptionId` VARCHAR(191) NOT NULL,
  `chatId` VARCHAR(191) NULL,
  `inputTokens` INTEGER NOT NULL,
  `outputTokens` INTEGER NOT NULL,
  `totalTokens` INTEGER NOT NULL,
  `usageCredits` DOUBLE NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE INDEX `usage_events_userId_idx` ON `usage_events`(`userId`);
CREATE INDEX `usage_events_subscriptionId_idx` ON `usage_events`(`subscriptionId`);
CREATE INDEX `usage_events_chatId_idx` ON `usage_events`(`chatId`);
CREATE INDEX `usage_events_createdAt_idx` ON `usage_events`(`createdAt`);

ALTER TABLE `usage_events`
  ADD CONSTRAINT `usage_events_userId_fkey`
  FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `usage_events`
  ADD CONSTRAINT `usage_events_subscriptionId_fkey`
  FOREIGN KEY (`subscriptionId`) REFERENCES `subscriptions`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `usage_events`
  ADD CONSTRAINT `usage_events_chatId_fkey`
  FOREIGN KEY (`chatId`) REFERENCES `chats`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
