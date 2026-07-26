# Deployment checklist

## Required environment variables

Set all of these in Vercel (or your deploy target) before going live.

| Variable | Notes |
|---|---|
| `NEXT_PUBLIC_APP_URL` | Your production HTTPS origin — e.g. `https://studyflow.app`. **No trailing slash. No fallback.** Missing = hard error at startup. |
| `NEXT_PUBLIC_SUPABASE_URL` | From your Supabase project settings |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | From your Supabase project settings |
| `SUPABASE_SERVICE_ROLE_KEY` | Server-only. Never expose to the client. |
| `STRIPE_SECRET_KEY` | Live key for production (`sk_live_...`) |
| `STRIPE_WEBHOOK_SECRET` | From Stripe dashboard → Webhooks → your endpoint |
| `STRIPE_PREMIUM_PRICE_ID` | Live price ID |
| `STRIPE_PREMIUM_YEARLY_PRICE_ID` | Live price ID |
| `STRIPE_PRO_PRICE_ID` | Live price ID |
| `STRIPE_PRO_YEARLY_PRICE_ID` | Live price ID |
| OpenAI / AI provider key | Whatever env var `src/app/api/ai/analyse/route.ts` reads |

## Database migration

Run **before** deploying the app:

```
supabase/migrations/20260726_active_assignment_lock.sql
```

Paste it in the Supabase SQL Editor and run it, or use `supabase db push` if you have the CLI set up.

This adds `create_assignment_atomic` — the server-side function the assignment creation route depends on. The app will return 500 on every new assignment until this is run.

## Supabase checks

- Auth cookies: confirm `SameSite=Lax` and `Secure` are set in your Supabase auth config for production.
- Confirm the `handle_new_user` trigger fires on signup and creates a profile row.
- Test auth callback redirect: sign up → verify email → should land on `/dashboard`, not `localhost`.

## Stripe checks

- Run a full checkout flow in Stripe test mode before switching to live keys.
- Confirm `checkout.session.completed` webhook upgrades the correct user tier.
- Confirm `invoice.payment_succeeded` maps the Stripe customer back to the right user and tier (resolved from price ID, not hardcoded).
- Confirm `customer.subscription.deleted` downgrades back to `free`.
- Verify webhook signature verification is enabled and `STRIPE_WEBHOOK_SECRET` matches the endpoint.

## App smoke tests

1. Sign up a fresh user → verify email → land on `/dashboard`.
2. Create an assignment → AI analysis → schedule generation.
3. Open the same assignment in two tabs → try to exceed the active limit in both simultaneously → only one should succeed.
4. Go to `/upgrade` → complete a Stripe test checkout → confirm tier updates in profile.
5. Trigger `invoice.payment_succeeded` from the Stripe test dashboard → confirm renewal is handled correctly.
6. Block all calendar time → run scheduler → confirm existing schedule is preserved (not wiped).
7. Complete a task → confirm pace log is written with valid hours.
