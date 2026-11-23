# Stock app — notes for agents

> Edit this file. It's the single biggest lever on agent quality: every agent reads it first.

## What this app is
A Laravel app for tracking my stock holdings and transactions. Single user today.

## Stack
- PHP 8.3, Laravel <version>, MySQL (SQLite in-memory for tests)
- Blade views, <CSS framework>
- External data: <e.g. Yahoo Finance via ...>

## Commands
- Run tests: `php artisan test`
- Run one test: `php artisan test --filter=HoldingTest`

## Conventions
- Validation lives in Form Request classes (`app/Http/Requests`), never inline in controllers.
- Money and prices: store as DECIMAL(15,4); round only when displaying.
- Every new route needs a Feature test, including an unauthenticated-access test.
- <add your own: naming, folder structure, things you hate seeing>

## Never
- Change migrations that already ran; add a new migration instead.
- Add Composer packages without saying so in the final summary.
- Call external APIs from tests; fake them with `Http::fake()`.
