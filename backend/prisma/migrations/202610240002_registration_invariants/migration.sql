-- Additional invariants; existing rows and existing active users are untouched.
ALTER TABLE "RegistrationApplication" ADD CONSTRAINT "registration_mobile_roles" CHECK ("role" IN ('PARENT','TEACHER'));
ALTER TABLE "RegistrationApplication" ADD CONSTRAINT "registration_email_normalized" CHECK (email = lower(email));
ALTER TABLE "UserProfile" ADD CONSTRAINT "profile_email_normalized" CHECK (email = lower(email));
ALTER TABLE "PrivatePhoto" ADD CONSTRAINT "photo_owner_required" CHECK ("applicationId" IS NOT NULL OR "userId" IS NOT NULL);
ALTER TABLE "PrivatePhoto" ADD CONSTRAINT "photo_safe_storage_key" CHECK ("storageKey" ~ '^[0-9a-f-]{36}$');
ALTER TABLE "RegistrationDecision" ADD CONSTRAINT "RegistrationDecision_reviewerId_fkey" FOREIGN KEY ("reviewerId") REFERENCES "User"(id);
ALTER TABLE "EnrollmentRequest" ADD CONSTRAINT "enrollment_owner_required" CHECK ("applicationId" IS NOT NULL OR "userId" IS NOT NULL);
ALTER TABLE "WearableRequest" ADD CONSTRAINT "wearable_owner_required" CHECK ("enrollmentId" IS NOT NULL OR "userId" IS NOT NULL);
