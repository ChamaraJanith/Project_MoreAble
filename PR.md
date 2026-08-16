# Pull Request: Feature - Guardian Details Fix, Dual Mobile Number Registration, & Forgot Password Flow

## 📌 Title
`feat(auth): Add Forgot Password reset flow, Dual Mobile Number registration, and Guardian sync fix`

---

## 📝 Description
This PR delivers key authentication and user management enhancements to the MoreAble application:
1. **Interactive Forgot Password / Reset Password Flow**: Users can now recover and update their account password by providing their Email, NIC Number, or Mobile Phone Number. Password reset requests update the hashed credentials securely in Firestore.
2. **Dual Mobile Number Registration**: Added support for both Primary and Secondary mobile numbers during user registration and rendered both in the Personal Information section of the profile screen.
3. **Guardian Details Synchronization**: Fixed a UI status mismatch and added automatic backend fetching for Guardian details stored in Firestore.

---

## ✨ Key Changes

### 🔑 Forgot Password Recovery Flow
- **[reset-password+api.ts](file:///c:/Campus_Projects/UEE/Project_MoreAble/app/api/auth/reset-password+api.ts)** *(NEW)*:
  - Created REST endpoint `POST /api/auth/reset-password`.
  - Queries Firestore `users` collection by Email, NIC, Primary Mobile Number, or Secondary Mobile Number.
  - Hashes new password with `bcrypt` and updates `passwordHash` in Firestore.
- **[ForgotPasswordForm.tsx](file:///c:/Campus_Projects/UEE/Project_MoreAble/src/features/auth/ui/ForgotPasswordForm.tsx)** *(NEW)*:
  - Accessible password recovery form component.
  - Features real-time password matching validation, loading state, error alerts, and success banner with automatic back-to-login routing.
- **[forgot-password.tsx](file:///c:/Campus_Projects/UEE/Project_MoreAble/app/%28auth%29/forgot-password.tsx)** *(NEW)* & **[_layout.tsx](file:///c:/Campus_Projects/UEE/Project_MoreAble/app/%28auth%29/_layout.tsx)**:
  - Registered `forgot-password` route screen in the `(auth)` stack.
- **[LoginForm.tsx](file:///c:/Campus_Projects/UEE/Project_MoreAble/src/features/auth/ui/LoginForm.tsx)**:
  - Updated **Forgot Password?** link to navigate to `/(auth)/forgot-password`.

### 📱 Dual Mobile Number Support
- **[types.ts](file:///c:/Campus_Projects/UEE/Project_MoreAble/src/entities/user/model/types.ts)** & **[authStore.ts](file:///c:/Campus_Projects/UEE/Project_MoreAble/src/shared/store/authStore.ts)**:
  - Added `secondaryPhoneNumber?: string | null` to `User`, `AuthUser`, and `UserRegistrationDTO`.
- **[RegistrationForm.tsx](file:///c:/Campus_Projects/UEE/Project_MoreAble/src/features/auth/ui/RegistrationForm.tsx)**:
  - Added input fields for **Primary Mobile Number *** and **Secondary Mobile Number *** with format and uniqueness validation.
- **[register+api.ts](file:///c:/Campus_Projects/UEE/Project_MoreAble/app/api/auth/register+api.ts)**:
  - Persists `secondaryPhoneNumber` to Firestore `users` collection.
- **[profile.tsx](file:///c:/Campus_Projects/UEE/Project_MoreAble/app/profile.tsx)**:
  - Displays both Primary Phone Number and Secondary Phone Number under Personal Information.

### 🛡️ Guardian Synchronization & Backend API
- **[index+api.ts](file:///c:/Campus_Projects/UEE/Project_MoreAble/app/api/guardians/index+api.ts)** *(NEW)*:
  - Created REST endpoints `GET /api/guardians` and `POST /api/guardians` for querying and updating Guardian records.
- **[login+api.ts](file:///c:/Campus_Projects/UEE/Project_MoreAble/app/api/auth/login+api.ts)**:
  - Automatically fetches and attaches `guardianDetails` on login response.
- **[profile.tsx](file:///c:/Campus_Projects/UEE/Project_MoreAble/app/profile.tsx)**:
  - Added automatic `useEffect` to load missing Guardian details on mount.

---

## 🧪 How to Test

### 1. Forgot Password Test
1. Go to the Sign In screen (`/(auth)`).
2. Click **Forgot Password?**.
3. Confirm navigation to `/forgot-password`.
4. Enter account Email, NIC, or Mobile Number.
5. Enter a new password (min 6 chars) and confirm password.
6. Tap **RESET PASSWORD**.
7. Verify success message and tap **BACK TO LOGIN** to log in with the new password.

### 2. Dual Mobile Number Registration Test
1. Go to Registration (`/(auth)/register`).
2. Fill in **Primary Mobile Number** (`0771234567`) and **Secondary Mobile Number** (`0719876543`).
3. Complete registration and verify both numbers display in `/profile`.

---

## 📋 Checklist
- [x] Code compiled cleanly with zero TypeScript errors (`npx tsc --noEmit`).
- [x] Password hashing security verified (`bcrypt` with 10 salt rounds).
- [x] Input validation and error messaging tested across all forms.
- [x] Cross-platform compatibility verified for Web and Mobile platforms.
