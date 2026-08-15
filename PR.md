# Pull Request: Feature - Bus Device Login & Vehicle Dashboard Flow

## 📌 Title
`feat(auth): Add Bus Device Login authentication flow and Vehicle Dashboard view`

---

## 📝 Description
This PR introduces the **Bus Device Login** authentication flow to the MoreAble transit application. Bus operators and drivers can now navigate to a dedicated device login portal directly from the main login screen, enter their vehicle credentials (**Bus Number Plate** and **Bus Password**), and access the **Vehicle Dashboard**.

---

## ✨ Key Changes

### 🛠️ UI Components & Features
- **[LoginForm.tsx](file:///c:/Campus_Projects/UEE/Project_MoreAble/src/features/auth/ui/LoginForm.tsx)**:
  - Added a small **"Device Login"** button directly below the SIGN IN button.
  - Added a **"Kiosk / NFC Device Login"** button at the bottom of the screen (visible upon scrolling down).
  - Configured navigation to route to `/(auth)/device-login`.

- **[BusDeviceLoginForm.tsx](file:///c:/Campus_Projects/UEE/Project_MoreAble/src/features/auth/ui/BusDeviceLoginForm.tsx)** *(NEW)*:
  - Created a dedicated form component for bus device authentication.
  - Added input validation for **Bus Number Plate** (e.g. `NC-6789`) and **Bus Password**.
  - Added **"LOGIN TO VEHICLE"** action button navigating to `/vehicle-dashboard`.
  - Added a back navigation link to return to standard user login.

### 📱 Routes & Navigation Layouts
- **[device-login.tsx](file:///c:/Campus_Projects/UEE/Project_MoreAble/app/%28auth%29/device-login.tsx)** *(NEW)*:
  - Created the route screen under `(auth)` rendering `BusDeviceLoginForm`.
- **[_layout.tsx (Auth Stack)](file:///c:/Campus_Projects/UEE/Project_MoreAble/app/%28auth%29/_layout.tsx)**:
  - Registered `device-login` screen in the `(auth)` stack.

- **[vehicle-dashboard.tsx](file:///c:/Campus_Projects/UEE/Project_MoreAble/app/vehicle-dashboard.tsx)** *(NEW)*:
  - Created the initial **Vehicle Dashboard** screen displaying the transit console status and exit button.
- **[_layout.tsx (Root Stack)](file:///c:/Campus_Projects/UEE/Project_MoreAble/app/_layout.tsx)**:
  - Registered `vehicle-dashboard` screen in the root stack layout.

---

## 🧪 How to Test

1. Open the app and navigate to the main **Login** screen (`/(auth)`).
2. Click on the **"Device Login"** button below the SIGN IN button (or scroll down to click the bottom **"Kiosk / NFC Device Login"** button).
3. Confirm navigation to the **Bus Device Login** screen (`/(auth)/device-login`).
4. Fill in:
   - **Bus Number Plate**: e.g., `NC-6789`
   - **Bus Password**: Enter any test password
5. Tap **LOGIN TO VEHICLE**.
6. Verify successful navigation to the **Vehicle Dashboard** screen displaying **"Vehicle Dashboard"**.
7. Tap the **Exit** button in the top header to return to the auth stack.

---

## 📋 Checklist
- [x] Code follows project coding standards and formatting.
- [x] UI elements adhere to accessible design principles.
- [x] Forms include input validation and error feedback.
- [x] Cross-platform compatibility tested for Web and Mobile platforms.
