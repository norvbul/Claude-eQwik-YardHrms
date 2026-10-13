-- CreateTable
CREATE TABLE `notifications` (
    `id` CHAR(36) NOT NULL,
    `tenant_id` CHAR(36) NULL,
    `user_id` CHAR(36) NOT NULL,
    `category` VARCHAR(30) NOT NULL,
    `type` VARCHAR(60) NOT NULL,
    `title` VARCHAR(190) NOT NULL,
    `body` VARCHAR(1000) NOT NULL,
    `link` VARCHAR(255) NULL,
    `dedupe_key` VARCHAR(160) NULL,
    `read_at` DATETIME(3) NULL,
    `email_status` VARCHAR(20) NOT NULL DEFAULT 'PENDING',
    `emailed_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `notifications_user_id_read_at_created_at_idx`(`user_id`, `read_at`, `created_at`),
    INDEX `notifications_email_status_created_at_idx`(`email_status`, `created_at`),
    UNIQUE INDEX `notifications_user_id_dedupe_key_key`(`user_id`, `dedupe_key`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `notification_preferences` (
    `user_id` CHAR(36) NOT NULL,
    `category` VARCHAR(30) NOT NULL,
    `email` BOOLEAN NOT NULL DEFAULT true,
    `updated_at` DATETIME(3) NOT NULL,

    PRIMARY KEY (`user_id`, `category`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `notifications` ADD CONSTRAINT `notifications_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `notification_preferences` ADD CONSTRAINT `notification_preferences_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

