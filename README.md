# example use

```ts
adapter: neon(
  process.env.DATABASE_URL as string,
  { user: "auth_user", key: "auth_key", session: "auth_session" }
)
```
