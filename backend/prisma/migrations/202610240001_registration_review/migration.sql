-- CreateEnum
CREATE TYPE "ReviewStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- AlterTable
ALTER TABLE "Child" ADD COLUMN     "dateOfBirth" DATE,
ADD COLUMN     "groupName" TEXT;

-- CreateTable
CREATE TABLE "UserProfile" (
    "userId" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "emergencyContacts" JSONB NOT NULL DEFAULT '[]',
    "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserProfile_pkey" PRIMARY KEY ("userId")
);

-- CreateTable
CREATE TABLE "CenterInvitation" (
    "id" TEXT NOT NULL,
    "centerId" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CenterInvitation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RegistrationApplication" (
    "id" TEXT NOT NULL,
    "receiptHash" TEXT NOT NULL,
    "payloadHash" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "passwordHash" TEXT,
    "role" "Role" NOT NULL,
    "centerId" TEXT NOT NULL,
    "status" "ReviewStatus" NOT NULL DEFAULT 'PENDING',
    "termsVersion" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewedAt" TIMESTAMPTZ(3),
    "reviewerId" TEXT,
    "reason" TEXT,
    "userId" TEXT,

    CONSTRAINT "RegistrationApplication_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RegistrationDecision" (
    "id" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "status" "ReviewStatus" NOT NULL,
    "reviewerId" TEXT NOT NULL,
    "reason" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RegistrationDecision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EnrollmentRequest" (
    "id" TEXT NOT NULL,
    "applicationId" TEXT,
    "userId" TEXT,
    "centerId" TEXT NOT NULL,
    "existingChildId" TEXT,
    "fullName" TEXT,
    "dateOfBirth" DATE,
    "groupName" TEXT,
    "relationship" TEXT NOT NULL,
    "childId" TEXT,
    "status" "ReviewStatus" NOT NULL DEFAULT 'PENDING',
    "reviewerId" TEXT,
    "reviewedAt" TIMESTAMPTZ(3),
    "reason" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EnrollmentRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DeviceClaimCode" (
    "id" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "consumedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DeviceClaimCode_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WearableRequest" (
    "id" TEXT NOT NULL,
    "enrollmentId" TEXT,
    "userId" TEXT,
    "childId" TEXT,
    "centerId" TEXT NOT NULL,
    "hardwareId" TEXT NOT NULL,
    "claimHash" TEXT NOT NULL,
    "status" "ReviewStatus" NOT NULL DEFAULT 'PENDING',
    "reviewerId" TEXT,
    "reviewedAt" TIMESTAMPTZ(3),
    "reason" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WearableRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PrivatePhoto" (
    "id" TEXT NOT NULL,
    "applicationId" TEXT,
    "userId" TEXT,
    "mime" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PrivatePhoto_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "UserProfile_email_key" ON "UserProfile"("email");

-- CreateIndex
CREATE UNIQUE INDEX "CenterInvitation_codeHash_key" ON "CenterInvitation"("codeHash");

-- CreateIndex
CREATE UNIQUE INDEX "RegistrationApplication_receiptHash_key" ON "RegistrationApplication"("receiptHash");

-- CreateIndex
CREATE UNIQUE INDEX "RegistrationApplication_username_key" ON "RegistrationApplication"("username");

-- CreateIndex
CREATE UNIQUE INDEX "RegistrationApplication_email_key" ON "RegistrationApplication"("email");

-- CreateIndex
CREATE UNIQUE INDEX "RegistrationApplication_userId_key" ON "RegistrationApplication"("userId");

-- CreateIndex
CREATE INDEX "RegistrationApplication_centerId_status_createdAt_idx" ON "RegistrationApplication"("centerId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "EnrollmentRequest_centerId_status_idx" ON "EnrollmentRequest"("centerId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "DeviceClaimCode_codeHash_key" ON "DeviceClaimCode"("codeHash");

-- CreateIndex
CREATE UNIQUE INDEX "WearableRequest_enrollmentId_key" ON "WearableRequest"("enrollmentId");

-- CreateIndex
CREATE INDEX "WearableRequest_centerId_status_idx" ON "WearableRequest"("centerId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "PrivatePhoto_applicationId_key" ON "PrivatePhoto"("applicationId");

-- CreateIndex
CREATE UNIQUE INDEX "PrivatePhoto_userId_key" ON "PrivatePhoto"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "PrivatePhoto_storageKey_key" ON "PrivatePhoto"("storageKey");

-- AddForeignKey
ALTER TABLE "UserProfile" ADD CONSTRAINT "UserProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CenterInvitation" ADD CONSTRAINT "CenterInvitation_centerId_fkey" FOREIGN KEY ("centerId") REFERENCES "Center"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RegistrationApplication" ADD CONSTRAINT "RegistrationApplication_centerId_fkey" FOREIGN KEY ("centerId") REFERENCES "Center"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RegistrationApplication" ADD CONSTRAINT "RegistrationApplication_reviewerId_fkey" FOREIGN KEY ("reviewerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RegistrationApplication" ADD CONSTRAINT "RegistrationApplication_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RegistrationDecision" ADD CONSTRAINT "RegistrationDecision_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "RegistrationApplication"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EnrollmentRequest" ADD CONSTRAINT "EnrollmentRequest_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "RegistrationApplication"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EnrollmentRequest" ADD CONSTRAINT "EnrollmentRequest_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EnrollmentRequest" ADD CONSTRAINT "EnrollmentRequest_centerId_fkey" FOREIGN KEY ("centerId") REFERENCES "Center"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EnrollmentRequest" ADD CONSTRAINT "EnrollmentRequest_childId_fkey" FOREIGN KEY ("childId") REFERENCES "Child"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EnrollmentRequest" ADD CONSTRAINT "EnrollmentRequest_reviewerId_fkey" FOREIGN KEY ("reviewerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeviceClaimCode" ADD CONSTRAINT "DeviceClaimCode_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "Device"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WearableRequest" ADD CONSTRAINT "WearableRequest_enrollmentId_fkey" FOREIGN KEY ("enrollmentId") REFERENCES "EnrollmentRequest"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WearableRequest" ADD CONSTRAINT "WearableRequest_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WearableRequest" ADD CONSTRAINT "WearableRequest_childId_fkey" FOREIGN KEY ("childId") REFERENCES "Child"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WearableRequest" ADD CONSTRAINT "WearableRequest_centerId_fkey" FOREIGN KEY ("centerId") REFERENCES "Center"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WearableRequest" ADD CONSTRAINT "WearableRequest_reviewerId_fkey" FOREIGN KEY ("reviewerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PrivatePhoto" ADD CONSTRAINT "PrivatePhoto_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "RegistrationApplication"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PrivatePhoto" ADD CONSTRAINT "PrivatePhoto_userId_fkey" FOREIGN KEY ("userId") REFERENCES "UserProfile"("userId") ON DELETE SET NULL ON UPDATE CASCADE;

