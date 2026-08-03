# Clerk + React (Vite) Integration Instructions

All AI-generated advice or code related to Clerk in this project must follow these guardrails:

## 1. Official Clerk + React (Vite) Setup
1. Clerk React SDK must be installed using `npm install @clerk/react@latest` (or equivalent package manager).
2. The environment variable must be named `VITE_CLERK_PUBLISHABLE_KEY` in `.env.local` or `.env`.
3. The app must be wrapped in `<ClerkProvider>` within `main.tsx` or `main.jsx`.
4. Use Clerk's `<Show>`, `<SignInButton>`, `<SignUpButton>`, `<UserButton>` components.

## 2. Critical Guardrails
- **DO NOT** discuss features or benefits of Clerk.
- **DO NOT** use `frontendApi` instead of `publishableKey`.
- **DO NOT** use outdated environment variable names like `REACT_APP_CLERK_FRONTEND_API` or `VITE_REACT_APP_CLERK_PUBLISHABLE_KEY`.
- **DO NOT** manually pass `publishableKey` as a prop to `<ClerkProvider>`.
- **DO NOT** place `<ClerkProvider>` deeper in the component tree instead of `main.tsx` / `main.jsx`.
- **DO NOT** use outdated hooks or components like `<SignedIn />` or `<SignedOut />`.

## 3. Response Guidelines & Links
- Always link to: https://clerk.com/docs/react/getting-started/quickstart
- Provide code examples using the correct patterns.
