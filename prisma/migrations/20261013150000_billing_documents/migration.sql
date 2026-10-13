-- AlterTable
ALTER TABLE `manual_payments` ADD COLUMN `invoice_id` CHAR(36) NULL;

-- CreateTable
CREATE TABLE `document_sequences` (
    `key` VARCHAR(40) NOT NULL,
    `next` INTEGER NOT NULL DEFAULT 1,
    `updated_at` DATETIME(3) NOT NULL,

    PRIMARY KEY (`key`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `invoices` (
    `id` CHAR(36) NOT NULL,
    `number` VARCHAR(30) NOT NULL,
    `customer_id` CHAR(36) NOT NULL,
    `subscription_id` CHAR(36) NULL,
    `plan_id` CHAR(36) NULL,
    `issue_date` DATE NOT NULL,
    `due_date` DATE NOT NULL,
    `currency` CHAR(3) NOT NULL,
    `lines` JSON NOT NULL,
    `subtotal` DECIMAL(18, 2) NOT NULL,
    `tax_rate` DECIMAL(6, 4) NOT NULL DEFAULT 0,
    `tax_amount` DECIMAL(18, 2) NOT NULL DEFAULT 0,
    `total` DECIMAL(18, 2) NOT NULL,
    `status` ENUM('ISSUED', 'PAID', 'VOID') NOT NULL DEFAULT 'ISSUED',
    `notes` VARCHAR(1000) NULL,
    `void_reason` VARCHAR(500) NULL,
    `storage_key` VARCHAR(255) NULL,
    `created_by_id` CHAR(36) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `invoices_number_key`(`number`),
    INDEX `invoices_customer_id_issue_date_idx`(`customer_id`, `issue_date`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `receipts` (
    `id` CHAR(36) NOT NULL,
    `number` VARCHAR(30) NOT NULL,
    `payment_id` CHAR(36) NOT NULL,
    `issued_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `storage_key` VARCHAR(255) NULL,
    `created_by_id` CHAR(36) NOT NULL,

    UNIQUE INDEX `receipts_number_key`(`number`),
    UNIQUE INDEX `receipts_payment_id_key`(`payment_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `manual_payments` ADD CONSTRAINT `manual_payments_invoice_id_fkey` FOREIGN KEY (`invoice_id`) REFERENCES `invoices`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `invoices` ADD CONSTRAINT `invoices_customer_id_fkey` FOREIGN KEY (`customer_id`) REFERENCES `customers`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `receipts` ADD CONSTRAINT `receipts_payment_id_fkey` FOREIGN KEY (`payment_id`) REFERENCES `manual_payments`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

