-- Account-level client profiles and goal enrichment from the Ultima client export
-- CreateEnum
CREATE TYPE "Gender" AS ENUM ('MALE', 'FEMALE', 'UNDISCLOSED', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "UgandaRegion" AS ENUM ('CENTRAL', 'EASTERN', 'NORTHERN', 'WESTERN');

-- CreateEnum
CREATE TYPE "LocationStatus" AS ENUM ('UGANDA_DISTRICT', 'ABROAD', 'UNMATCHED', 'MISSING');

-- CreateEnum
CREATE TYPE "PhoneNetwork" AS ENUM ('MTN', 'AIRTEL', 'OTHER_UG', 'FOREIGN', 'UNKNOWN');

-- AlterTable
ALTER TABLE "goals" ADD COLUMN     "riskScore" INTEGER,
ADD COLUMN     "sponsorTitle" TEXT,
ADD COLUMN     "ultimaEnabled" BOOLEAN,
ADD COLUMN     "ultimaGoalName" TEXT;

-- CreateTable
CREATE TABLE "account_profiles" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "gender" "Gender" NOT NULL DEFAULT 'UNKNOWN',
    "dateOfBirth" DATE,
    "districtRaw" TEXT,
    "districtId" TEXT,
    "country" TEXT,
    "locationStatus" "LocationStatus" NOT NULL DEFAULT 'MISSING',
    "signupSourceRaw" TEXT,
    "signupChannel" TEXT,
    "signupPlatform" TEXT,
    "signupPartner" TEXT,
    "phoneNetwork" "PhoneNetwork" NOT NULL DEFAULT 'UNKNOWN',
    "userJoinedAt" TIMESTAMP(3),
    "portalEnabled" BOOLEAN,
    "enrollmentStatus" TEXT,
    "contactClosed" BOOLEAN NOT NULL DEFAULT false,
    "sponsorAccountNumber" TEXT,
    "institutionName" TEXT,
    "sourceFile" TEXT,
    "importedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "account_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "districts" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "region" "UgandaRegion" NOT NULL,

    CONSTRAINT "districts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "account_profiles_accountId_key" ON "account_profiles"("accountId");

-- CreateIndex
CREATE INDEX "account_profiles_gender_idx" ON "account_profiles"("gender");

-- CreateIndex
CREATE INDEX "account_profiles_districtId_idx" ON "account_profiles"("districtId");

-- CreateIndex
CREATE INDEX "account_profiles_locationStatus_idx" ON "account_profiles"("locationStatus");

-- CreateIndex
CREATE INDEX "account_profiles_dateOfBirth_idx" ON "account_profiles"("dateOfBirth");

-- CreateIndex
CREATE INDEX "account_profiles_signupChannel_idx" ON "account_profiles"("signupChannel");

-- CreateIndex
CREATE UNIQUE INDEX "districts_name_key" ON "districts"("name");

-- CreateIndex
CREATE INDEX "districts_region_idx" ON "districts"("region");

-- CreateIndex
CREATE INDEX "goals_riskScore_idx" ON "goals"("riskScore");

-- AddForeignKey
ALTER TABLE "account_profiles" ADD CONSTRAINT "account_profiles_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "account_profiles" ADD CONSTRAINT "account_profiles_districtId_fkey" FOREIGN KEY ("districtId") REFERENCES "districts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

