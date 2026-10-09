-- CreateTable
CREATE TABLE `User` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `username` VARCHAR(100) NOT NULL,
    `email` VARCHAR(190) NULL,
    `fullName` VARCHAR(190) NOT NULL,
    `passwordHash` VARCHAR(255) NOT NULL,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `mustChangePassword` BOOLEAN NOT NULL DEFAULT false,
    `failedLogins` INTEGER NOT NULL DEFAULT 0,
    `lockedUntil` DATETIME(3) NULL,
    `lastLoginAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Role` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `code` VARCHAR(50) NOT NULL,
    `name` VARCHAR(100) NOT NULL,
    `description` VARCHAR(255) NULL,
    `isSystem` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Permission` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `code` VARCHAR(80) NOT NULL,
    `description` VARCHAR(255) NULL,
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `RolePermission` (
    `roleId` INTEGER NOT NULL,
    `permissionId` INTEGER NOT NULL,
    PRIMARY KEY (`roleId`, `permissionId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `UserRole` (
    `userId` INTEGER NOT NULL,
    `roleId` INTEGER NOT NULL,
    PRIMARY KEY (`userId`, `roleId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `UserDepartmentAssignment` (
    `userId` INTEGER NOT NULL,
    `departmentId` INTEGER NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    PRIMARY KEY (`userId`, `departmentId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Session` (
    `id` CHAR(64) NOT NULL,
    `userId` INTEGER NOT NULL,
    `csrfToken` VARCHAR(64) NOT NULL,
    `ipAddress` VARCHAR(64) NULL,
    `userAgent` VARCHAR(255) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `lastSeenAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `idleExpiresAt` DATETIME(3) NOT NULL,
    `absoluteExpiresAt` DATETIME(3) NOT NULL,
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `PasswordResetToken` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `userId` INTEGER NOT NULL,
    `tokenHash` CHAR(64) NOT NULL,
    `expiresAt` DATETIME(3) NOT NULL,
    `usedAt` DATETIME(3) NULL,
    `createdById` INTEGER NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Department` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `code` VARCHAR(30) NOT NULL,
    `name` VARCHAR(100) NOT NULL,
    `ticketPrefix` VARCHAR(8) NOT NULL,
    `sortOrder` INTEGER NOT NULL DEFAULT 0,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `isClinical` BOOLEAN NOT NULL DEFAULT false,
    `sequencePolicy` ENUM('DAILY', 'CONTINUOUS') NOT NULL DEFAULT 'DAILY',
    `workflowStages` TEXT NOT NULL,
    `serviceTypes` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ServiceCounter` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `departmentId` INTEGER NOT NULL,
    `name` VARCHAR(100) NOT NULL,
    `kind` VARCHAR(20) NOT NULL DEFAULT 'COUNTER',
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `RoutingRule` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `fromDepartmentId` INTEGER NOT NULL,
    `toDepartmentId` INTEGER NOT NULL,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `requiresReason` BOOLEAN NOT NULL DEFAULT false,
    `emergencyOnly` BOOLEAN NOT NULL DEFAULT false,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Patient` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `mrn` VARCHAR(40) NOT NULL,
    `fullName` VARCHAR(190) NOT NULL,
    `nameKey` VARCHAR(190) NOT NULL,
    `dateOfBirth` DATE NULL,
    `sex` ENUM('FEMALE', 'MALE', 'OTHER', 'UNKNOWN') NOT NULL DEFAULT 'UNKNOWN',
    `phone` VARCHAR(30) NULL,
    `nationalId` VARCHAR(40) NULL,
    `address` VARCHAR(255) NULL,
    `isTest` BOOLEAN NOT NULL DEFAULT false,
    `createdById` INTEGER NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Visit` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `visitNumber` VARCHAR(40) NOT NULL,
    `patientId` INTEGER NOT NULL,
    `status` ENUM('ACTIVE', 'COMPLETED', 'CANCELLED') NOT NULL DEFAULT 'ACTIVE',
    `isEmergency` BOOLEAN NOT NULL DEFAULT false,
    `isTest` BOOLEAN NOT NULL DEFAULT false,
    `idempotencyKey` VARCHAR(80) NULL,
    `reasonForVisit` VARCHAR(255) NULL,
    `billingClearedAt` DATETIME(3) NULL,
    `closedAt` DATETIME(3) NULL,
    `closedById` INTEGER NULL,
    `closureReason` VARCHAR(255) NULL,
    `createdById` INTEGER NULL,
    `openedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `QueueSequence` (
    `departmentId` INTEGER NOT NULL,
    `scopeKey` VARCHAR(20) NOT NULL,
    `lastNumber` INTEGER NOT NULL DEFAULT 0,
    `updatedAt` DATETIME(3) NOT NULL,
    PRIMARY KEY (`departmentId`, `scopeKey`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `QueueTicket` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `visitId` INTEGER NOT NULL,
    `departmentId` INTEGER NOT NULL,
    `scopeKey` VARCHAR(20) NOT NULL,
    `ticketNumber` INTEGER NOT NULL,
    `displayNumber` VARCHAR(20) NOT NULL,
    `status` ENUM('WAITING', 'CALLED', 'IN_SERVICE', 'ON_HOLD', 'ABSENT', 'COMPLETED', 'REFERRED', 'SKIPPED', 'CANCELLED') NOT NULL DEFAULT 'WAITING',
    `priority` INTEGER NOT NULL DEFAULT 0,
    `priorityReason` VARCHAR(255) NULL,
    `serviceType` VARCHAR(60) NULL,
    `workflowStage` VARCHAR(60) NULL,
    `resultStatus` ENUM('NOT_APPLICABLE', 'PENDING', 'AVAILABLE') NOT NULL DEFAULT 'NOT_APPLICABLE',
    `counterId` INTEGER NULL,
    `referralId` INTEGER NULL,
    `parentTicketId` INTEGER NULL,
    `idempotencyKey` VARCHAR(80) NULL,
    `callCount` INTEGER NOT NULL DEFAULT 0,
    `statusReason` VARCHAR(255) NULL,
    `enteredAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `firstCalledAt` DATETIME(3) NULL,
    `lastCalledAt` DATETIME(3) NULL,
    `serviceStartedAt` DATETIME(3) NULL,
    `completedAt` DATETIME(3) NULL,
    `calledById` INTEGER NULL,
    `servedById` INTEGER NULL,
    `createdById` INTEGER NULL,
    `version` INTEGER NOT NULL DEFAULT 0,
    `updatedAt` DATETIME(3) NOT NULL,
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `JourneyEvent` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `visitId` INTEGER NOT NULL,
    `ticketId` INTEGER NULL,
    `departmentId` INTEGER NULL,
    `eventType` VARCHAR(40) NOT NULL,
    `fromStatus` VARCHAR(30) NULL,
    `toStatus` VARCHAR(30) NULL,
    `userId` INTEGER NULL,
    `reason` VARCHAR(255) NULL,
    `metadata` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ClinicalReferral` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `visitId` INTEGER NOT NULL,
    `fromTicketId` INTEGER NULL,
    `fromDepartmentId` INTEGER NOT NULL,
    `toDepartmentId` INTEGER NOT NULL,
    `serviceType` VARCHAR(60) NULL,
    `priority` INTEGER NOT NULL DEFAULT 0,
    `notes` TEXT NULL,
    `status` ENUM('PENDING', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED') NOT NULL DEFAULT 'PENDING',
    `createdById` INTEGER NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `completedAt` DATETIME(3) NULL,
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Invoice` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `invoiceNumber` VARCHAR(40) NOT NULL,
    `visitId` INTEGER NOT NULL,
    `description` VARCHAR(255) NULL,
    `totalMinor` INTEGER NOT NULL,
    `paidMinor` INTEGER NOT NULL DEFAULT 0,
    `currency` VARCHAR(3) NOT NULL DEFAULT 'KES',
    `status` ENUM('ISSUED', 'PARTIALLY_PAID', 'PAID', 'VOID') NOT NULL DEFAULT 'ISSUED',
    `createdById` INTEGER NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Payment` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `invoiceId` INTEGER NOT NULL,
    `amountMinor` INTEGER NOT NULL,
    `method` VARCHAR(30) NOT NULL,
    `reference` VARCHAR(80) NULL,
    `receiptNumber` VARCHAR(40) NOT NULL,
    `idempotencyKey` VARCHAR(80) NULL,
    `confirmedById` INTEGER NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Notification` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `eventKey` VARCHAR(120) NOT NULL,
    `departmentId` INTEGER NOT NULL,
    `type` VARCHAR(40) NOT NULL,
    `title` VARCHAR(190) NOT NULL,
    `body` VARCHAR(255) NULL,
    `ticketId` INTEGER NULL,
    `visitId` INTEGER NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `NotificationRead` (
    `userId` INTEGER NOT NULL,
    `notificationId` INTEGER NOT NULL,
    `readAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    PRIMARY KEY (`userId`, `notificationId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `OutboxEvent` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `topic` VARCHAR(40) NOT NULL,
    `departmentId` INTEGER NULL,
    `payload` TEXT NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `dispatchedAt` DATETIME(3) NULL,
    `attempts` INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `AuditLog` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `userId` INTEGER NULL,
    `action` VARCHAR(60) NOT NULL,
    `entityType` VARCHAR(40) NULL,
    `entityId` VARCHAR(40) NULL,
    `ipAddress` VARCHAR(64) NULL,
    `userAgent` VARCHAR(255) NULL,
    `metadata` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `SystemSetting` (
    `key` VARCHAR(80) NOT NULL,
    `value` TEXT NOT NULL,
    `updatedById` INTEGER NULL,
    `updatedAt` DATETIME(3) NOT NULL,
    PRIMARY KEY (`key`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE UNIQUE INDEX `User_username_key` ON `User`(`username`);

-- CreateIndex
CREATE UNIQUE INDEX `User_email_key` ON `User`(`email`);

-- CreateIndex
CREATE UNIQUE INDEX `Role_code_key` ON `Role`(`code`);

-- CreateIndex
CREATE UNIQUE INDEX `Permission_code_key` ON `Permission`(`code`);

-- CreateIndex
CREATE INDEX `UserDepartmentAssignment_departmentId_idx` ON `UserDepartmentAssignment`(`departmentId`);

-- CreateIndex
CREATE INDEX `Session_userId_idx` ON `Session`(`userId`);

-- CreateIndex
CREATE INDEX `Session_idleExpiresAt_idx` ON `Session`(`idleExpiresAt`);

-- CreateIndex
CREATE UNIQUE INDEX `PasswordResetToken_tokenHash_key` ON `PasswordResetToken`(`tokenHash`);

-- CreateIndex
CREATE INDEX `PasswordResetToken_userId_idx` ON `PasswordResetToken`(`userId`);

-- CreateIndex
CREATE UNIQUE INDEX `Department_code_key` ON `Department`(`code`);

-- CreateIndex
CREATE UNIQUE INDEX `ServiceCounter_departmentId_name_key` ON `ServiceCounter`(`departmentId`, `name`);

-- CreateIndex
CREATE UNIQUE INDEX `RoutingRule_fromDepartmentId_toDepartmentId_key` ON `RoutingRule`(`fromDepartmentId`, `toDepartmentId`);

-- CreateIndex
CREATE UNIQUE INDEX `Patient_mrn_key` ON `Patient`(`mrn`);

-- CreateIndex
CREATE INDEX `Patient_nameKey_idx` ON `Patient`(`nameKey`);

-- CreateIndex
CREATE INDEX `Patient_phone_idx` ON `Patient`(`phone`);

-- CreateIndex
CREATE INDEX `Patient_nationalId_idx` ON `Patient`(`nationalId`);

-- CreateIndex
CREATE INDEX `Patient_createdAt_idx` ON `Patient`(`createdAt`);

-- CreateIndex
CREATE UNIQUE INDEX `Visit_visitNumber_key` ON `Visit`(`visitNumber`);

-- CreateIndex
CREATE UNIQUE INDEX `Visit_idempotencyKey_key` ON `Visit`(`idempotencyKey`);

-- CreateIndex
CREATE INDEX `Visit_patientId_openedAt_idx` ON `Visit`(`patientId`, `openedAt`);

-- CreateIndex
CREATE INDEX `Visit_status_openedAt_idx` ON `Visit`(`status`, `openedAt`);

-- CreateIndex
CREATE INDEX `Visit_openedAt_idx` ON `Visit`(`openedAt`);

-- CreateIndex
CREATE UNIQUE INDEX `QueueTicket_idempotencyKey_key` ON `QueueTicket`(`idempotencyKey`);

-- CreateIndex
CREATE UNIQUE INDEX `QueueTicket_departmentId_scopeKey_ticketNumber_key` ON `QueueTicket`(`departmentId`, `scopeKey`, `ticketNumber`);

-- CreateIndex
CREATE INDEX `QueueTicket_departmentId_status_priority_enteredAt_id_idx` ON `QueueTicket`(`departmentId`, `status`, `priority`, `enteredAt`, `id`);

-- CreateIndex
CREATE INDEX `QueueTicket_visitId_idx` ON `QueueTicket`(`visitId`);

-- CreateIndex
CREATE INDEX `QueueTicket_status_lastCalledAt_idx` ON `QueueTicket`(`status`, `lastCalledAt`);

-- CreateIndex
CREATE INDEX `QueueTicket_enteredAt_idx` ON `QueueTicket`(`enteredAt`);

-- CreateIndex
CREATE INDEX `JourneyEvent_visitId_createdAt_idx` ON `JourneyEvent`(`visitId`, `createdAt`);

-- CreateIndex
CREATE INDEX `JourneyEvent_ticketId_createdAt_idx` ON `JourneyEvent`(`ticketId`, `createdAt`);

-- CreateIndex
CREATE INDEX `JourneyEvent_eventType_createdAt_idx` ON `JourneyEvent`(`eventType`, `createdAt`);

-- CreateIndex
CREATE INDEX `ClinicalReferral_visitId_idx` ON `ClinicalReferral`(`visitId`);

-- CreateIndex
CREATE INDEX `ClinicalReferral_toDepartmentId_status_idx` ON `ClinicalReferral`(`toDepartmentId`, `status`);

-- CreateIndex
CREATE UNIQUE INDEX `Invoice_invoiceNumber_key` ON `Invoice`(`invoiceNumber`);

-- CreateIndex
CREATE INDEX `Invoice_visitId_idx` ON `Invoice`(`visitId`);

-- CreateIndex
CREATE UNIQUE INDEX `Payment_receiptNumber_key` ON `Payment`(`receiptNumber`);

-- CreateIndex
CREATE UNIQUE INDEX `Payment_idempotencyKey_key` ON `Payment`(`idempotencyKey`);

-- CreateIndex
CREATE INDEX `Payment_invoiceId_idx` ON `Payment`(`invoiceId`);

-- CreateIndex
CREATE UNIQUE INDEX `Notification_eventKey_key` ON `Notification`(`eventKey`);

-- CreateIndex
CREATE INDEX `Notification_departmentId_createdAt_idx` ON `Notification`(`departmentId`, `createdAt`);

-- CreateIndex
CREATE INDEX `OutboxEvent_dispatchedAt_id_idx` ON `OutboxEvent`(`dispatchedAt`, `id`);

-- CreateIndex
CREATE INDEX `OutboxEvent_topic_id_idx` ON `OutboxEvent`(`topic`, `id`);

-- CreateIndex
CREATE INDEX `AuditLog_createdAt_idx` ON `AuditLog`(`createdAt`);

-- CreateIndex
CREATE INDEX `AuditLog_userId_createdAt_idx` ON `AuditLog`(`userId`, `createdAt`);

-- CreateIndex
CREATE INDEX `AuditLog_action_createdAt_idx` ON `AuditLog`(`action`, `createdAt`);

-- CreateIndex
CREATE INDEX `AuditLog_entityType_entityId_idx` ON `AuditLog`(`entityType`, `entityId`);

-- AddForeignKey
ALTER TABLE `RolePermission` ADD CONSTRAINT `RolePermission_roleId_fkey` FOREIGN KEY (`roleId`) REFERENCES `Role`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `RolePermission` ADD CONSTRAINT `RolePermission_permissionId_fkey` FOREIGN KEY (`permissionId`) REFERENCES `Permission`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `UserRole` ADD CONSTRAINT `UserRole_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `UserRole` ADD CONSTRAINT `UserRole_roleId_fkey` FOREIGN KEY (`roleId`) REFERENCES `Role`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `UserDepartmentAssignment` ADD CONSTRAINT `UserDepartmentAssignment_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `UserDepartmentAssignment` ADD CONSTRAINT `UserDepartmentAssignment_departmentId_fkey` FOREIGN KEY (`departmentId`) REFERENCES `Department`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Session` ADD CONSTRAINT `Session_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PasswordResetToken` ADD CONSTRAINT `PasswordResetToken_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ServiceCounter` ADD CONSTRAINT `ServiceCounter_departmentId_fkey` FOREIGN KEY (`departmentId`) REFERENCES `Department`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `RoutingRule` ADD CONSTRAINT `RoutingRule_fromDepartmentId_fkey` FOREIGN KEY (`fromDepartmentId`) REFERENCES `Department`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `RoutingRule` ADD CONSTRAINT `RoutingRule_toDepartmentId_fkey` FOREIGN KEY (`toDepartmentId`) REFERENCES `Department`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Visit` ADD CONSTRAINT `Visit_patientId_fkey` FOREIGN KEY (`patientId`) REFERENCES `Patient`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `QueueSequence` ADD CONSTRAINT `QueueSequence_departmentId_fkey` FOREIGN KEY (`departmentId`) REFERENCES `Department`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `QueueTicket` ADD CONSTRAINT `QueueTicket_visitId_fkey` FOREIGN KEY (`visitId`) REFERENCES `Visit`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `QueueTicket` ADD CONSTRAINT `QueueTicket_departmentId_fkey` FOREIGN KEY (`departmentId`) REFERENCES `Department`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `QueueTicket` ADD CONSTRAINT `QueueTicket_counterId_fkey` FOREIGN KEY (`counterId`) REFERENCES `ServiceCounter`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `JourneyEvent` ADD CONSTRAINT `JourneyEvent_visitId_fkey` FOREIGN KEY (`visitId`) REFERENCES `Visit`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `JourneyEvent` ADD CONSTRAINT `JourneyEvent_ticketId_fkey` FOREIGN KEY (`ticketId`) REFERENCES `QueueTicket`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `JourneyEvent` ADD CONSTRAINT `JourneyEvent_departmentId_fkey` FOREIGN KEY (`departmentId`) REFERENCES `Department`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ClinicalReferral` ADD CONSTRAINT `ClinicalReferral_visitId_fkey` FOREIGN KEY (`visitId`) REFERENCES `Visit`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ClinicalReferral` ADD CONSTRAINT `ClinicalReferral_fromDepartmentId_fkey` FOREIGN KEY (`fromDepartmentId`) REFERENCES `Department`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ClinicalReferral` ADD CONSTRAINT `ClinicalReferral_toDepartmentId_fkey` FOREIGN KEY (`toDepartmentId`) REFERENCES `Department`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Invoice` ADD CONSTRAINT `Invoice_visitId_fkey` FOREIGN KEY (`visitId`) REFERENCES `Visit`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Payment` ADD CONSTRAINT `Payment_invoiceId_fkey` FOREIGN KEY (`invoiceId`) REFERENCES `Invoice`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Notification` ADD CONSTRAINT `Notification_departmentId_fkey` FOREIGN KEY (`departmentId`) REFERENCES `Department`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `NotificationRead` ADD CONSTRAINT `NotificationRead_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `NotificationRead` ADD CONSTRAINT `NotificationRead_notificationId_fkey` FOREIGN KEY (`notificationId`) REFERENCES `Notification`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `AuditLog` ADD CONSTRAINT `AuditLog_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
